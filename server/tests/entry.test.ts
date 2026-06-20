import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import { EntryRepository } from '../repositories/entry.repository';
import { EntryService } from '../services/entry.service';
import { Database } from '../db';

// Mock DB client
vi.mock('../db.client', () => {
  return {
    shouldUseMock: vi.fn().mockReturnValue(true),
    prisma: {},
    initDb: vi.fn()
  };
});

describe('Entry System Unit and Integration Tests', () => {
  let entryRepository: EntryRepository;
  let entryService: EntryService;
  let currentDbPath: string;

  beforeEach(() => {
    vi.clearAllMocks();

    currentDbPath = path.join(process.cwd(), 'data', `db.test-entries-${crypto.randomUUID()}.json`);
    process.env.DB_PATH = currentDbPath;

    entryRepository = new EntryRepository();
    entryService = new EntryService();

    // Mock AIService, StorageService, MemoryService in EntryService
    (entryService as any).aiService = {
      analyzeEntry: vi.fn().mockResolvedValue({ mood: 'peaceful', tags: ['peace', 'mindful'] }),
      generateEmbedding: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
      describeImage: vi.fn().mockResolvedValue('Image description')
    };

    (entryService as any).storageService = {
      uploadFile: vi.fn().mockResolvedValue('http://storage/image.jpg'),
      deleteFile: vi.fn().mockResolvedValue(true)
    };

    (entryService as any).memoryService = {
      extractAndProcessMemories: vi.fn().mockResolvedValue(true)
    };

    (entryService as any).longTermMemoryService = {
      extractAndProcess: vi.fn().mockResolvedValue(true)
    };

    (entryService as any).graphService = {
      extractAndProcessGraph: vi.fn().mockResolvedValue(true)
    };
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

  describe('EntryRepository Mock Operations', () => {
    it('should create and retrieve journal entries with image assets', async () => {
      const entry = {
        id: 'entry-1',
        userId: 'user-1',
        title: 'Peaceful day',
        content: 'I had a quiet walk.',
        mood: 'peaceful',
        tags: ['walk'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await entryRepository.create(entry);

      const found = await entryRepository.findById('entry-1', 'user-1');
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Peaceful day');

      const all = await entryRepository.findAllByUserId('user-1');
      expect(all.length).toBe(1);
    });

    it('should update and delete journal entries', async () => {
      const entry = {
        id: 'entry-1',
        userId: 'user-1',
        title: 'Day 1',
        content: 'Original content.',
        mood: 'calm',
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await entryRepository.create(entry);

      const updated = await entryRepository.update('entry-1', 'user-1', {
        title: 'Updated Day 1',
        content: 'New content.'
      });

      expect(updated).not.toBeNull();
      expect(updated!.title).toBe('Updated Day 1');
      expect(updated!.content).toBe('New content.');

      const deleted = await entryRepository.delete('entry-1', 'user-1');
      expect(deleted).toBe(true);

      const notFound = await entryRepository.findById('entry-1', 'user-1');
      expect(notFound).toBeNull();
    });

    it('should handle image asset utility operations', async () => {
      const img = {
        id: 'img-1',
        entryId: 'entry-1',
        imageUrl: 'http://img.jpg',
        description: 'Mock desc',
        createdAt: new Date().toISOString()
      };

      await entryRepository.createImageAsset(img);

      const found = await entryRepository.findImageAssetById('img-1');
      expect(found).not.toBeNull();
      expect(found!.imageUrl).toBe('http://img.jpg');

      const deleted = await entryRepository.deleteImageAsset('img-1');
      expect(deleted).toBe(true);

      const notFound = await entryRepository.findImageAssetById('img-1');
      expect(notFound).toBeNull();
    });

    it('should rank keyword matches based on occurrences in title/content', async () => {
      const entry1 = { id: 'e-1', userId: 'user-1', title: 'Happy Gym Day', content: 'Workout was great.', mood: 'happy', tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      const entry2 = { id: 'e-2', userId: 'user-1', title: 'Work Office Day', content: 'Office office office.', mood: 'bored', tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      Database.saveEntries([entry1, entry2]);

      const results = await entryRepository.searchKeyword('user-1', 'Gym office');
      expect(results.length).toBe(2);
      // 'Gym' is in entry1 title (weight 2.0). 'office' is in entry2 title (2.0) and content (3 * 1.0). Total rank for entry2 is 5.0, for entry1 is 2.0.
      expect(results[0].entryId).toBe('e-2');
    });
  });

  describe('EntryService RAG Chunks, Embeddings and Hybrid Search', () => {
    it('should create an entry and generate vector chunks', async () => {
      // 1. Create an entry (mocking AI details)
      const content = 'I went to the park and meditated. It was so peaceful. ' + 'Word '.repeat(600); // > 500 words to force multiple chunks
      
      const entry = await entryService.createEntry(
        'user-1',
        'Morning Walk',
        content
      );

      expect(entry.id).toBeDefined();
      expect(entry.mood).toBe('peaceful');

      // 2. Chunks should have been created in chunkRepository
      const chunks = Database.getChunks();
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].entryId).toBe(entry.id);
    });

    it('should handle hybrid entries search', async () => {
      const entry1 = { id: 'e-1', userId: 'user-1', title: 'Gym Workout', content: 'Feeling active.', mood: 'happy', tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      Database.saveEntries([entry1]);

      // Mock chunk results
      (entryService as any).chunkRepository.findTopSimilar = vi.fn().mockResolvedValue([
        { entryId: 'e-1', content: 'Gym Workout', chunkIndex: 0, score: 0.9, similarity: 0.85 }
      ]);

      const searchResults = await entryService.searchEntries('user-1', 'Gym workout');
      expect(searchResults.length).toBe(1);
      expect(searchResults[0].entry.id).toBe('e-1');
      // Score calculation: 0.7 * semantic + 0.3 * keyword rank
      expect(searchResults[0].score).toBeGreaterThan(0);
    });

    it('should fall back to keyword search if embedding generation throws', async () => {
      const entry1 = { id: 'e-1', userId: 'user-1', title: 'Happy Gym Workout', content: 'Feeling active.', mood: 'happy', tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      Database.saveEntries([entry1]);

      // Force generateEmbedding to throw
      (entryService as any).aiService.generateEmbedding = vi.fn().mockRejectedValue(new Error('API quota exceeded'));

      const searchResults = await entryService.searchEntries('user-1', 'Gym');
      expect(searchResults.length).toBe(1);
      expect(searchResults[0].entry.id).toBe('e-1');
      expect(searchResults[0].score).toBe(0.3); // simple fallback scoring matches keyword query (0.3 * 1.0)
    });
  });
});
