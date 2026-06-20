import { GraphRepository } from '../repositories/graph.repository';
import { getAI } from './ai.service';

export class GraphService {
  private graphRepository = new GraphRepository();

  public async getGraph(userId: string) {
    const entities = await this.graphRepository.getEntities(userId);
    const relationships = await this.graphRepository.getRelationships(userId);

    // Format for visualization
    const nodes = entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt
    }));

    const links = relationships.map((r) => ({
      id: r.id,
      source: r.sourceId,
      target: r.targetId,
      type: r.type,
      strength: r.strength,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));

    return { nodes, links };
  }

  public async extractAndProcessGraph(
    userId: string,
    entryContent: string,
    apiKey?: string
  ): Promise<void> {
    try {
      const existingEntities = await this.graphRepository.getEntities(userId);
      const existingRelationships = await this.graphRepository.getRelationships(userId);

      const activeEntitiesText = existingEntities
        .map((e) => `[Name: ${e.name}, Type: ${e.type}]`)
        .join(', ');

      const activeRelationshipsText = existingRelationships
        .map((r) => {
          const s = existingEntities.find((e) => e.id === r.sourceId);
          const t = existingEntities.find((e) => e.id === r.targetId);
          if (s && t) {
            return `[${s.name} (${s.type}) -> ${t.name} (${t.type}) via ${r.type} (strength: ${r.strength})]`;
          }
          return '';
        })
        .filter(Boolean)
        .join(', ');

      const ai = getAI(apiKey);

      const p = `You are a narrative psychologist and knowledge graph engineer. Analyze the following new journal entry.
Your task is to extract entities and their relationships to construct a personal reflection graph.

Entity Types:
- "people": Friends, family, coworkers, or any individuals mentioned (e.g., "Sarah", "boss").
- "places": Locations (e.g., "gym", "library", "office", "home").
- "projects": Specific ongoing endeavors or works (e.g., "compiler design", "presentation", "diaries app").
- "goals": Specific desired outcomes (e.g., "run a 5k", "pass the exam", "finish coding").
- "habits": Recurring routines or behaviors (e.g., "meditation", "gym", "running", "writing").
- "emotions": Feelings or mood states (e.g., "confidence", "anxiety", "motivation", "peace", "frustration").

Relationship Rules:
Identify connections between the extracted entities. Specifically, capture influence, trigger, and causality links:
- e.g. "Gym" (habit) improves/boosts "Confidence" (emotion) -> Gym -> Confidence
- e.g. "Exam" (project/goal) causes/triggers "Anxiety" (emotion) -> Exam -> Anxiety
- e.g. "Forge" (place/project) increases/sparks "Motivation" (emotion) -> Forge -> Motivation
Determine a relationship type from this list: "triggers", "improves", "hinders", "relates_to", "participates_in".

Existing Entities for the User:
${activeEntitiesText || 'None'}

Existing Relationships for the User:
${activeRelationshipsText || 'None'}

New Journal Entry:
"${entryContent}"

Respond STRICTLY with a JSON object matching this schema, completely without markdown formatting:
{
  "extractedEntities": [
    { "name": "string (canonicalized name, title case, e.g., 'Gym', 'Sarah', 'Confidence')", "type": "people|places|projects|goals|habits|emotions" }
  ],
  "extractedRelationships": [
    {
      "sourceName": "string (must match a name in extractedEntities or existingEntities)",
      "sourceType": "people|places|projects|goals|habits|emotions",
      "targetName": "string (must match a name in extractedEntities or existingEntities)",
      "targetType": "people|places|projects|goals|habits|emotions",
      "type": "triggers|improves|hinders|relates_to|participates_in"
    }
  ]
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: p,
        config: {
          responseMimeType: 'application/json'
        }
      });

      let text = response.text?.trim() || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        text = jsonMatch[0];
      }
      const result = JSON.parse(text);

      const resolvedEntitiesMap = new Map<string, string>(); // name_type -> ID

      // 1. Resolve and create entities
      for (const ent of result.extractedEntities || []) {
        const key = `${ent.name.toLowerCase().trim()}_${ent.type.toLowerCase().trim()}`;
        const existing = await this.graphRepository.findEntityByNameAndType(userId, ent.name, ent.type);
        if (existing) {
          resolvedEntitiesMap.set(key, existing.id);
        } else {
          const created = await this.graphRepository.createEntity(userId, ent.name, ent.type);
          resolvedEntitiesMap.set(key, created.id);
        }
      }

      // Also populate existing entities into the map to resolve relations referring to existing ones
      for (const extEnt of existingEntities) {
        const key = `${extEnt.name.toLowerCase().trim()}_${extEnt.type.toLowerCase().trim()}`;
        if (!resolvedEntitiesMap.has(key)) {
          resolvedEntitiesMap.set(key, extEnt.id);
        }
      }

      // 2. Resolve and create relationships
      for (const rel of result.extractedRelationships || []) {
        const sourceKey = `${rel.sourceName.toLowerCase().trim()}_${rel.sourceType.toLowerCase().trim()}`;
        const targetKey = `${rel.targetName.toLowerCase().trim()}_${rel.targetType.toLowerCase().trim()}`;

        const sourceId = resolvedEntitiesMap.get(sourceKey);
        const targetId = resolvedEntitiesMap.get(targetKey);

        if (!sourceId || !targetId) {
          console.warn(`Could not resolve entity ids for relation: ${rel.sourceName} -> ${rel.targetName}. Skipping.`);
          continue;
        }

        const existingRel = await this.graphRepository.findRelationship(userId, sourceId, targetId, rel.type);
        if (existingRel) {
          await this.graphRepository.incrementRelationshipStrength(existingRel.id, existingRel.strength + 1);
        } else {
          await this.graphRepository.createRelationship(userId, sourceId, targetId, rel.type);
        }
      }

    } catch (err) {
      console.error('Graph extraction failed:', err);
    }
  }

  public async generateReflection(userId: string, apiKey?: string): Promise<string> {
    try {
      const entities = await this.graphRepository.getEntities(userId);
      const relationships = await this.graphRepository.getRelationships(userId);

      if (entities.length === 0 || relationships.length === 0) {
        return 'Your reflection graph is quiet right now. Once you begin reflecting on daily habits, goals, and emotions, I will start drawing connections.';
      }

      const activeEntitiesText = entities
        .map((e) => `[${e.name} (${e.type})]`)
        .join(', ');

      const activeRelationshipsText = relationships
        .map((r) => {
          const s = entities.find((e) => e.id === r.sourceId);
          const t = entities.find((e) => e.id === r.targetId);
          if (s && t) {
            return `[${s.name} (${s.type}) -> ${t.name} (${t.type}) via ${r.type} (strength: ${r.strength})]`;
          }
          return '';
        })
        .filter(Boolean)
        .join(', ');

      const ai = getAI(apiKey);

      const prompt = `You are "Satori", an expert AI wisdom companion blending narrative psychology and cognitive architecture.
Below is the structured personal reflection graph of the user. It documents their active habits, projects, places, people, goals, and emotions, alongside the causal/trigger/influence links between them.

Active Entities:
${activeEntitiesText}

Extracted Relationships:
${activeRelationshipsText}

Your task is to analyze these graph connections and generate a beautiful, editorial narrative reflection in Markdown format (2 paragraphs max).
Synthesize the relationships to draw meaningful psychological insights. Specifically, highlight trigger loops or helpful actions (e.g. how a habit like Gym improves an emotion like Confidence, or how an Exam triggers Anxiety and how they navigate it).
Speak in a warm, poetic, and encouraging voice. Do not list items mechanically; weave them into a narrative of self-discovery and growth.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      return response.text || 'Unable to generate reflection at this time.';
    } catch (err: any) {
      console.error('Failed to generate graph reflection:', err);
      return `Failed to generate reflection: ${err.message || err}`;
    }
  }
}
