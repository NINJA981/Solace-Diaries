import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AIService, getAI } from '../services/ai.service';
import { GoogleGenAI } from '@google/genai';

// Hoist mocks to avoid reference before initialization errors
const { generateContentMock, embedContentMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
  embedContentMock: vi.fn(),
}));

// Mock the GoogleGenAI library
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: generateContentMock,
        embedContent: embedContentMock,
      };
    },
  };
});

describe('AIService - Context Compression', () => {
  let aiService: AIService;
  let mockGenAIInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-api-key';
    aiService = new AIService();
    mockGenAIInstance = getAI();
  });

  describe('compressContext', () => {
    it('should return empty string when context entries are empty', async () => {
      const result = await aiService.compressContext('How was my week?', [], 'custom-key');
      expect(result).toBe('');
      expect(mockGenAIInstance.models.generateContent).not.toHaveBeenCalled();
    });

    it('should call generateContent with compression prompt and return compressed text', async () => {
      const entries = [
        { title: 'Day 1', date: '2026-06-18', content: 'Today was a very long day. I felt quite anxious about my exam but ended up passing it.' }
      ];
      
      mockGenAIInstance.models.generateContent.mockResolvedValueOnce({
        text: 'Compressed: Passed anxious exam.'
      });

      const result = await aiService.compressContext('How did the exam go?', entries, 'custom-key');
      
      expect(result).toBe('Compressed: Passed anxious exam.');
      expect(mockGenAIInstance.models.generateContent).toHaveBeenCalledTimes(1);
      
      const callArgs = mockGenAIInstance.models.generateContent.mock.calls[0][0];
      expect(callArgs.model).toBe('gemini-2.5-flash');
      expect(callArgs.contents).toContain('anxious');
      expect(callArgs.contents).toContain('Day 1');
      expect(callArgs.contents).toContain('How did the exam go?');
    });

    it('should fall back to raw formatted entries if API call fails', async () => {
      const entries = [
        { title: 'Day 1', date: '2026-06-18', content: 'Feeling happy.' }
      ];
      
      mockGenAIInstance.models.generateContent.mockRejectedValueOnce(new Error('API Error'));

      const result = await aiService.compressContext('How did I feel?', entries, 'custom-key');
      
      expect(result).toContain('[Entry #1] Date: 2026-06-18 | Title: Day 1');
      expect(result).toContain('Feeling happy.');
    });
  });

  describe('retrieveAndAnswer', () => {
    it('should compress context first and then generate the final response using compressed context', async () => {
      const entries = [
        { title: 'Day 1', date: '2026-06-18', content: 'Very sad.' }
      ];
      
      // First mock call is for compressContext
      mockGenAIInstance.models.generateContent.mockResolvedValueOnce({
        text: 'Compressed context: Felt sad.'
      });
      
      // Second mock call is for generateContent in retrieveAndAnswer
      mockGenAIInstance.models.generateContent.mockResolvedValueOnce({
        text: 'Satori response.'
      });

      const result = await aiService.retrieveAndAnswer('What was my mood?', entries, 'custom-key');

      expect(result).toBe('Satori response.');
      expect(mockGenAIInstance.models.generateContent).toHaveBeenCalledTimes(2);

      // Verify first call did compression
      const compressCallArgs = mockGenAIInstance.models.generateContent.mock.calls[0][0];
      expect(compressCallArgs.contents).toContain('context compression');

      // Verify second call used compressed context
      const answerCallArgs = mockGenAIInstance.models.generateContent.mock.calls[1][0];
      expect(answerCallArgs.contents).toContain('Compressed context: Felt sad.');
      expect(answerCallArgs.contents).toContain('Satori');
    });
  });
});
