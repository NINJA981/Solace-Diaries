import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import { LongTermMemoryRepository } from '../repositories/longterm-memory.repository';
import { LongTermMemoryService } from '../services/longterm-memory.service';

// Mock DB client
vi.mock('../db.client', () => {
  return {
    shouldUseMock: vi.fn().mockReturnValue(true),
    prisma: {},
    initDb: vi.fn()
  };
});

describe('Long-Term Memory System', () => {
  let repository: LongTermMemoryRepository;
  let service: LongTermMemoryService;
  let mockAiService: any;
  let currentDbPath: string;

  beforeEach(() => {
    // Generate a unique database path for this specific test to ensure strict parallel isolation
    currentDbPath = path.join(process.cwd(), 'data', `db.test-${crypto.randomUUID()}.json`);
    process.env.DB_PATH = currentDbPath;

    repository = new LongTermMemoryRepository();
    service = new LongTermMemoryService();

    mockAiService = {
      generateEmbedding: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
      analyzeEntry: vi.fn(),
      getAI: vi.fn().mockReturnValue({
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: JSON.stringify({
              newMemories: [{ content: 'User enjoys Formula 1', confidence: 0.9 }],
              updateMemories: [],
              deleteMemories: []
            })
          })
        }
      })
    };

    // Inject mock AI service
    (service as any).aiService = mockAiService;
    // Bind service to test repository
    (service as any).longTermMemoryRepository = repository;
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

  it('should save and retrieve memory fragments', async () => {
    const memory = await repository.create('user-1', 'User enjoys Formula 1', 0.9, new Array(768).fill(0.2));
    expect(memory.id).toBeDefined();
    expect(memory.content).toBe('User enjoys Formula 1');
    expect(memory.confidence).toBe(0.9);

    const retrieved = await repository.findAllByUserId('user-1');
    expect(retrieved.length).toBe(1);
    expect(retrieved[0].content).toBe('User enjoys Formula 1');
  });

  it('should find top similar memories', async () => {
    const v1 = new Array(768).fill(0.0);
    v1[0] = 1.0; // vector pointing along x-axis
    await repository.create('user-1', 'Target Memory', 0.8, v1);

    const v2 = new Array(768).fill(0.0);
    v2[1] = 1.0; // orthogonal vector
    await repository.create('user-1', 'Orthogonal Memory', 0.5, v2);

    const queryVector = new Array(768).fill(0.0);
    queryVector[0] = 0.9; // similar to v1

    const results = await repository.findTopSimilar('user-1', queryVector, 2);
    expect(results.length).toBe(2);
    expect(results[0].content).toBe('Target Memory');
  });

  it('should run memory extraction pipeline, deduplicate and merge', async () => {
    // 1. First run extracts "User enjoys Formula 1"
    await service.extractAndProcess('user-1', 'I watch Formula 1 every weekend and really enjoy it.');
    
    let memories = await repository.findAllByUserId('user-1');
    expect(memories.length).toBe(1);
    expect(memories[0].content).toBe('User enjoys Formula 1');
    expect(memories[0].confidence).toBe(0.9);

    // 2. Second run updates it
    (service as any).aiService.getAI = vi.fn().mockReturnValue({
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            newMemories: [],
            updateMemories: [{ id: memories[0].id, content: 'User is a passionate Formula 1 enthusiast', confidence: 0.95 }],
            deleteMemories: []
          })
        })
      }
    });

    await service.extractAndProcess('user-1', 'Formula 1 is definitely my absolute favorite sport now.');
    
    memories = await repository.findAllByUserId('user-1');
    expect(memories.length).toBe(1);
    expect(memories[0].content).toBe('User is a passionate Formula 1 enthusiast');
    expect(memories[0].confidence).toBe(0.95);
  });
});
