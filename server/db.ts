import * as fs from 'fs';
import * as path from 'path';

// Database path will be resolved dynamically at runtime via getDbPath() to support testing overrides

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface ImageAsset {
  id: string;
  entryId: string;
  imageUrl: string;
  description?: string;
  createdAt: string;
}

export interface JournalEntry {
  id: string;
  userId: string;
  title: string;
  content: string;
  mood: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  images?: ImageAsset[];
}

export interface VectorRecord {
  id: string;
  entryId: string;
  userId: string;
  vector: number[];
  createdAt: string;
}

export interface JournalChunk {
  id: string;
  entryId: string;
  content: string;
  chunkIndex: number;
  vector: number[];
  createdAt: string;
}

export interface MemoryFragment {
  id: string;
  userId: string;
  category: string;
  content: string;
  strength: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProactivePrompt {
  id: string;
  userId: string;
  memoryFragmentId: string | null;
  promptText: string;
  triggerType: string;
  scheduledFor: string;
  isDelivered: boolean;
  deliveredAt: string | null;
  userResponse: string | null;
  createdAt: string;
}

export interface DbMemory {
  id: string;
  userId: string;
  content: string;
  confidence: number;
  vector: number[];
  createdAt: string;
  updatedAt: string;
}

export interface GraphEntity {
  id: string;
  userId: string;
  name: string;
  type: string;
  createdAt: string;
  updatedAt: string;
}

export interface GraphRelationship {
  id: string;
  userId: string;
  sourceId: string;
  targetId: string;
  type: string;
  strength: number;
  createdAt: string;
  updatedAt: string;
}

export interface DbSchema {
  users: User[];
  entries: JournalEntry[];
  vectors: VectorRecord[];
  chunks?: JournalChunk[];
  memories: MemoryFragment[];
  prompts: ProactivePrompt[];
  imageAssets?: ImageAsset[];
  longTermMemories?: DbMemory[];
  entities?: GraphEntity[];
  relationships?: GraphRelationship[];
}

export class Database {
  private static getDbPath(): string {
    return process.env.DB_PATH || path.join(process.cwd(), 'data', 'db.json');
  }

  private static load(): DbSchema {
    const dbPath = this.getDbPath();
    try {
      if (!fs.existsSync(dbPath)) {
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const initial: DbSchema = { users: [], entries: [], vectors: [], chunks: [], memories: [], prompts: [], imageAssets: [], longTermMemories: [] };
        fs.writeFileSync(dbPath, JSON.stringify(initial, null, 2), 'utf-8');
        return initial;
      }
      const data = fs.readFileSync(dbPath, 'utf-8');
      const parsed = JSON.parse(data);
      return {
        users: parsed.users || [],
        entries: parsed.entries || [],
        vectors: parsed.vectors || [],
        chunks: parsed.chunks || [],
        memories: parsed.memories || [],
        prompts: parsed.prompts || [],
        imageAssets: parsed.imageAssets || [],
        longTermMemories: parsed.longTermMemories || [],
        entities: parsed.entities || [],
        relationships: parsed.relationships || []
      };
    } catch (err) {
      console.error('Failed to load database. Returning empty schema.', err);
      return { users: [], entries: [], vectors: [], chunks: [], memories: [], prompts: [] };
    }
  }

  private static save(schema: DbSchema): void {
    const dbPath = this.getDbPath();
    try {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(dbPath, JSON.stringify(schema, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save database.', err);
    }
  }

  public static getUsers(): User[] {
    return this.load().users;
  }

  public static saveUsers(users: User[]): void {
    const db = this.load();
    db.users = users;
    this.save(db);
  }

  public static getEntries(): JournalEntry[] {
    return this.load().entries;
  }

  public static saveEntries(entries: JournalEntry[]): void {
    const db = this.load();
    db.entries = entries;
    this.save(db);
  }

  public static getVectors(): VectorRecord[] {
    return this.load().vectors;
  }

  public static saveVectors(vectors: VectorRecord[]): void {
    const db = this.load();
    db.vectors = vectors;
    this.save(db);
  }

  public static getChunks(): JournalChunk[] {
    return this.load().chunks || [];
  }

  public static saveChunks(chunks: JournalChunk[]): void {
    const db = this.load();
    db.chunks = chunks;
    this.save(db);
  }

  public static getMemories(): MemoryFragment[] {
    return this.load().memories;
  }

  public static saveMemories(memories: MemoryFragment[]): void {
    const db = this.load();
    db.memories = memories;
    this.save(db);
  }

  public static getPrompts(): ProactivePrompt[] {
    return this.load().prompts;
  }

  public static savePrompts(prompts: ProactivePrompt[]): void {
    const db = this.load();
    db.prompts = prompts;
    this.save(db);
  }

  public static getImageAssets(): ImageAsset[] {
    return this.load().imageAssets || [];
  }

  public static saveImageAssets(imageAssets: ImageAsset[]): void {
    const db = this.load();
    db.imageAssets = imageAssets;
    this.save(db);
  }

  public static getLongTermMemories(): DbMemory[] {
    return this.load().longTermMemories || [];
  }

  public static saveLongTermMemories(memories: DbMemory[]): void {
    const db = this.load();
    db.longTermMemories = memories;
    this.save(db);
  }

  public static getEntities(): GraphEntity[] {
    return this.load().entities || [];
  }

  public static saveEntities(entities: GraphEntity[]): void {
    const db = this.load();
    db.entities = entities;
    this.save(db);
  }

  public static getRelationships(): GraphRelationship[] {
    return this.load().relationships || [];
  }

  public static saveRelationships(relationships: GraphRelationship[]): void {
    const db = this.load();
    db.relationships = relationships;
    this.save(db);
  }
}
