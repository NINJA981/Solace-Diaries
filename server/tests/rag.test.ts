import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import { chunkText } from '../services/chunker';
import { ChunkRepository } from '../repositories/chunk.repository';
import { GraphRepository } from '../repositories/graph.repository';
import { GraphService } from '../services/graph.service';
import { LongTermMemoryService } from '../services/longterm-memory.service';
import { Database } from '../db';

// Mock DB client
vi.mock('../db.client', () => {
  return {
    shouldUseMock: vi.fn().mockReturnValue(true),
    prisma: {},
    initDb: vi.fn()
  };
});

describe('RAG System and Chunker Unit Tests', () => {
  let chunkRepository: ChunkRepository;
  let graphRepository: GraphRepository;
  let graphService: GraphService;
  let longTermMemoryService: LongTermMemoryService;
  let currentDbPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Set up dynamic test db path to isolate tests and prevent conflicts
    currentDbPath = path.join(process.cwd(), 'data', `db.test-rag-${crypto.randomUUID()}.json`);
    process.env.DB_PATH = currentDbPath;

    chunkRepository = new ChunkRepository();
    graphRepository = new GraphRepository();
    graphService = new GraphService();
    longTermMemoryService = new LongTermMemoryService();
  });

  afterEach(() => {
    if (fs.existsSync(currentDbPath)) {
      try {
        fs.unlinkSync(currentDbPath);
      } catch (err) {
        console.warn('Failed to delete temporary test database:', err);
      }
    }
  });

  describe('chunkText Sliding Window Chunker', () => {
    it('should return empty array for empty inputs', () => {
      expect(chunkText('')).toEqual([]);
      expect(chunkText('   ')).toEqual([]);
    });

    it('should return single chunk if words length is within maxSize', () => {
      const text = 'Hello world, this is a short journal entry.';
      const result = chunkText(text, 10, 20, 5);
      expect(result).toEqual([text]);
    });

    it('should split text into multiple chunks with overlap', () => {
      // 15 words
      const words = Array.from({ length: 15 }, (_, i) => `word${i}`);
      const text = words.join(' ');
      
      const chunks = chunkText(text, 3, 5, 2);
      expect(chunks.length).toBe(5);
      expect(chunks[0]).toBe('word0 word1 word2 word3 word4');
      expect(chunks[1]).toBe('word3 word4 word5 word6 word7');
    });

    it('should handle last chunk adjustment if too small', () => {
      // 7 words
      const words = Array.from({ length: 7 }, (_, i) => `w${i}`);
      const text = words.join(' ');

      const chunks = chunkText(text, 4, 5, 2);
      expect(chunks.length).toBe(2);
      expect(chunks[0]).toBe('w0 w1 w2 w3 w4');
      expect(chunks[1]).toBe('w3 w4 w5 w6');
    });
  });

  describe('ChunkRepository', () => {
    it('should save and delete chunks', async () => {
      const chunk = {
        id: 'chunk-1',
        entryId: 'entry-1',
        content: 'Journal chunk content',
        chunkIndex: 0,
        vector: new Array(768).fill(0.25),
        createdAt: new Date().toISOString()
      };

      await chunkRepository.saveChunk(chunk);

      const dbChunks = Database.getChunks();
      expect(dbChunks.length).toBe(1);
      expect(dbChunks[0].content).toBe('Journal chunk content');

      await chunkRepository.deleteChunksByEntryId('entry-1');
      expect(Database.getChunks().length).toBe(0);
    });

    it('should find top similar chunks with recency decay', async () => {
      // Setup entries
      const entry1 = { id: 'entry-1', userId: 'user-1', title: 'Day 1', content: 'Today was good.', mood: 'happy', tags: ['happy'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      const entry2 = { id: 'entry-2', userId: 'user-1', title: 'Day 2', content: 'Feeling down.', mood: 'sad', tags: ['sad'], createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), updatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString() }; // 60 days ago
      
      Database.saveEntries([entry1, entry2]);

      const v1 = new Array(768).fill(0.1);
      v1[0] = 1.0;
      
      const v2 = new Array(768).fill(0.1);
      v2[0] = 1.0;

      const chunk1 = { id: 'c-1', entryId: 'entry-1', content: 'happy chunk', chunkIndex: 0, vector: v1, createdAt: entry1.createdAt };
      const chunk2 = { id: 'c-2', entryId: 'entry-2', content: 'sad chunk', chunkIndex: 0, vector: v2, createdAt: entry2.createdAt };

      Database.saveChunks([chunk1, chunk2]);

      const queryVector = new Array(768).fill(0.1);
      queryVector[0] = 0.9;

      const results = await chunkRepository.findTopSimilar('user-1', queryVector, 2);
      expect(results.length).toBe(2);
      expect(results[0].entryId).toBe('entry-1');
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });
  });

  describe('GraphRepository Entities & Relationships', () => {
    it('should return empty list when no entities or relationships exist', async () => {
      const entities = await graphRepository.getEntities('user-1');
      const relationships = await graphRepository.getRelationships('user-1');
      expect(entities).toEqual([]);
      expect(relationships).toEqual([]);
    });

    it('should find entity by name and type case-insensitively', async () => {
      await graphRepository.createEntity('user-1', '   Gym   ', 'habits');
      
      const found = await graphRepository.findEntityByNameAndType('user-1', 'gym', 'habits');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Gym');
    });

    it('should return null if entity name or type does not match', async () => {
      await graphRepository.createEntity('user-1', 'Gym', 'habits');
      
      const found1 = await graphRepository.findEntityByNameAndType('user-1', 'Gym', 'emotions');
      const found2 = await graphRepository.findEntityByNameAndType('user-1', 'Office', 'habits');
      expect(found1).toBeNull();
      expect(found2).toBeNull();
    });

    it('should increment relationship strength', async () => {
      const e1 = await graphRepository.createEntity('user-1', 'Gym', 'habits');
      const e2 = await graphRepository.createEntity('user-1', 'Confidence', 'emotions');
      
      const rel = await graphRepository.createRelationship('user-1', e1.id, e2.id, 'improves');
      expect(rel.strength).toBe(1);

      const incremented = await graphRepository.incrementRelationshipStrength(rel.id, 3);
      expect(incremented.strength).toBe(3);

      await expect(graphRepository.incrementRelationshipStrength('invalid-id', 5))
        .rejects.toThrow('Relationship not found');
    });
  });

  describe('GraphService', () => {
    it('should return quiet reflection text for empty graph', async () => {
      const reflection = await graphService.generateReflection('user-1');
      expect(reflection).toContain('reflection graph is quiet');
    });

    it('should return message if generation fails due to missing AI', async () => {
      const e1 = await graphRepository.createEntity('user-1', 'Gym', 'habits');
      const e2 = await graphRepository.createEntity('user-1', 'Confidence', 'emotions');
      await graphRepository.createRelationship('user-1', e1.id, e2.id, 'improves');

      // Bind graphRepository to graphService
      (graphService as any).graphRepository = graphRepository;

      const reflection = await graphService.generateReflection('user-1');
      expect(reflection).toContain('Failed to generate reflection');
    });
  });

  describe('LongTermMemoryService', () => {
    it('should return empty list when no memories exist', async () => {
      const memories = await longTermMemoryService.getMemories('user-1');
      expect(memories).toEqual([]);
    });

    it('should search memories using embedding similarity', async () => {
      const mockAi = {
        generateEmbedding: vi.fn().mockResolvedValue(new Array(768).fill(0.5))
      };
      (longTermMemoryService as any).aiService = mockAi;

      const memories = await longTermMemoryService.searchMemories('user-1', 'query');
      expect(memories).toEqual([]);
      expect(mockAi.generateEmbedding).toHaveBeenCalledWith('query');
    });
  });
});
