import { vi, describe, it, expect, beforeEach } from 'vitest';
import { GraphRepository } from '../repositories/graph.repository';
import { GraphService } from '../services/graph.service';
import { ChatService } from '../services/chat.service';
import { Database } from '../db';
import * as dbClient from '../db.client';
import * as aiServiceModule from '../services/ai.service';

// Mock DB client
vi.mock('../db.client', () => {
  return {
    shouldUseMock: vi.fn().mockReturnValue(true),
    prisma: {},
    initDb: vi.fn()
  };
});

describe('Reflection Graph System', () => {
  let repository: GraphRepository;
  let service: GraphService;
  let mockEntities: any[] = [];
  let mockRelationships: any[] = [];

  beforeEach(() => {
    vi.clearAllMocks();

    mockEntities = [];
    mockRelationships = [];

    // Spy on Database static methods
    vi.spyOn(Database, 'getEntities').mockImplementation(() => mockEntities);
    vi.spyOn(Database, 'saveEntities').mockImplementation((ents) => {
      mockEntities = ents;
    });
    vi.spyOn(Database, 'getRelationships').mockImplementation(() => mockRelationships);
    vi.spyOn(Database, 'saveRelationships').mockImplementation((rels) => {
      mockRelationships = rels;
    });

    repository = new GraphRepository();
    service = new GraphService();
  });

  describe('GraphRepository', () => {
    it('should create and retrieve entities', async () => {
      const entity = await repository.createEntity('user-1', 'Gym', 'habits');
      expect(entity.id).toBeDefined();
      expect(entity.name).toBe('Gym');
      expect(entity.type).toBe('habits');

      const found = await repository.findEntityByNameAndType('user-1', 'Gym', 'habits');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(entity.id);

      const all = await repository.getEntities('user-1');
      expect(all.length).toBe(1);
    });

    it('should create and retrieve relationships', async () => {
      const gym = await repository.createEntity('user-1', 'Gym', 'habits');
      const confidence = await repository.createEntity('user-1', 'Confidence', 'emotions');

      const rel = await repository.createRelationship('user-1', gym.id, confidence.id, 'improves');
      expect(rel.id).toBeDefined();
      expect(rel.sourceId).toBe(gym.id);
      expect(rel.targetId).toBe(confidence.id);
      expect(rel.strength).toBe(1);

      const found = await repository.findRelationship('user-1', gym.id, confidence.id, 'improves');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(rel.id);

      await repository.incrementRelationshipStrength(rel.id, 5);
      const updated = await repository.findRelationship('user-1', gym.id, confidence.id, 'improves');
      expect(updated!.strength).toBe(5);
    });
  });

  describe('GraphService', () => {
    it('should run graph extraction and perform deduplication', async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: JSON.stringify({
          extractedEntities: [
            { name: 'Gym', type: 'habits' },
            { name: 'Confidence', type: 'emotions' }
          ],
          extractedRelationships: [
            { sourceName: 'Gym', sourceType: 'habits', targetName: 'Confidence', targetType: 'emotions', type: 'improves' }
          ]
        })
      });

      // Mock getAI
      vi.spyOn(aiServiceModule, 'getAI').mockReturnValue({
        models: {
          generateContent: mockGenerateContent
        }
      } as any);

      // Run extraction
      await service.extractAndProcessGraph('user-1', 'I went to the Gym and felt great Confidence.');

      // Check entities were created
      expect(mockEntities.length).toBe(2);
      expect(mockEntities.find(e => e.name === 'Gym')).toBeDefined();
      expect(mockEntities.find(e => e.name === 'Confidence')).toBeDefined();

      // Check relationship was created with strength 1
      expect(mockRelationships.length).toBe(1);
      expect(mockRelationships[0].strength).toBe(1);

      // Run extraction again to test deduplication and strength increment
      await service.extractAndProcessGraph('user-1', 'Going to the Gym boosts my Confidence.');
      expect(mockEntities.length).toBe(2); // no new entities
      expect(mockRelationships.length).toBe(1); // no new relationships
      expect(mockRelationships[0].strength).toBe(2); // strength incremented
    });

    it('should generate reflections from graph connections', async () => {
      const gym = await repository.createEntity('user-1', 'Gym', 'habits');
      const confidence = await repository.createEntity('user-1', 'Confidence', 'emotions');
      await repository.createRelationship('user-1', gym.id, confidence.id, 'improves');

      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: 'This is a beautiful narrative reflection about Gym and Confidence.'
      });

      vi.spyOn(aiServiceModule, 'getAI').mockReturnValue({
        models: {
          generateContent: mockGenerateContent
        }
      } as any);

      const reflection = await service.generateReflection('user-1', 'test-key');
      expect(reflection).toBe('This is a beautiful narrative reflection about Gym and Confidence.');
    });
  });

  describe('ChatService RAG Integration', () => {
    it('should inject graph context into finalEntries if a keyword matches', async () => {
      // Create a gym entity and relationship in mock DB
      const gym = await repository.createEntity('user-1', 'Gym', 'habits');
      const confidence = await repository.createEntity('user-1', 'Confidence', 'emotions');
      await repository.createRelationship('user-1', gym.id, confidence.id, 'improves');

      // Bind repository to service
      const chatService = new ChatService();
      (chatService as any).graphRepository = repository;

      // Mock chunk retrieval and aiService response
      (chatService as any).chunkRepository.findTopSimilar = vi.fn().mockResolvedValue([]);
      (chatService as any).entryRepository.findAllByUserId = vi.fn().mockResolvedValue([
        { id: '1', title: 'Day 1', content: 'Today I visited the Gym.', createdAt: new Date().toISOString(), tags: [], mood: 'happy' }
      ]);
      (chatService as any).compressionService.compress = vi.fn().mockResolvedValue({
        entries: [{ title: 'Day 1', date: '2026-06-19', content: 'Today I visited the Gym.' }]
      });

      (chatService as any).aiService.generateEmbedding = vi.fn().mockResolvedValue(new Array(768).fill(0.1));
      const mockRetrieveAndAnswer = vi.fn().mockResolvedValue('Answer response.');
      (chatService as any).aiService.retrieveAndAnswer = mockRetrieveAndAnswer;

      await chatService.askPastEntries('user-1', 'How does the Gym affect me?', 'test-key');

      expect(mockRetrieveAndAnswer).toHaveBeenCalledTimes(1);
      const contextEntries = mockRetrieveAndAnswer.mock.calls[0][1];
      
      // Should have injected the graph connection as a special entry
      const graphEntry = contextEntries.find((e: any) => e.title === 'Structured Reflection Graph Connections');
      expect(graphEntry).toBeDefined();
      expect(graphEntry.content).toContain('Gym');
      expect(graphEntry.content).toContain('Confidence');
    });
  });
});
