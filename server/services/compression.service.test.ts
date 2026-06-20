import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { ContextCompressionService, type ContextEntry } from './compression.service';

// ---------------------------------------------------------------------------
// Mock the ai.service module so we never hit the real Gemini API.
// ---------------------------------------------------------------------------
vi.mock('./ai.service', () => ({
  getAI: vi.fn(),
}));

import { getAI } from './ai.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake Gemini AI client whose generateContent resolves with `text`. */
function mockAI(text: string) {
  (getAI as Mock).mockReturnValue({
    models: {
      generateContent: vi.fn().mockResolvedValue({ text }),
    },
  });
}

/** Build a fake Gemini AI client whose generateContent rejects. */
function mockAIFailure(error: Error) {
  (getAI as Mock).mockReturnValue({
    models: {
      generateContent: vi.fn().mockRejectedValue(error),
    },
  });
}

const sampleEntries: ContextEntry[] = [
  {
    title: 'A long walk home',
    date: '2025-12-01',
    content:
      'Today I went on a very long walk through the park near my house. ' +
      'The leaves were golden and the air was cool. I felt a deep sense of ' +
      'peace and gratitude for the small moments. I bumped into Maya at the ' +
      'coffee shop and we talked about her new job at Meridian Corp. She ' +
      'starts on January 15th. I felt happy for her but also a twinge of ' +
      'envy — I have been feeling stuck in my own career lately. ' +
      'The sunset was breathtaking, painting the sky in shades of amber ' +
      'and rose. I promised myself I would walk more often.',
  },
  {
    title: 'Late-night thoughts',
    date: '2025-12-02',
    content:
      'Could not sleep again. My mind keeps racing about the project ' +
      'deadline on December 20th. I feel anxious and overwhelmed. ' +
      'I tried the breathing exercise Dr. Patel recommended — ' +
      '4-7-8 breathing — and it helped a little. I journaled for 20 ' +
      'minutes and that calmed me down. I am grateful for this space ' +
      'to process my thoughts. Tomorrow I will break the project into ' +
      'smaller tasks and ask Sam for help with the data analysis section.',
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContextCompressionService', () => {
  let service: ContextCompressionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ContextCompressionService();
  });

  // ---- Empty input --------------------------------------------------------

  it('returns empty entries and zero metrics for empty input', async () => {
    const result = await service.compress('anything', []);

    expect(result.entries).toEqual([]);
    expect(result.metrics).toEqual({
      originalChars: 0,
      compressedChars: 0,
      compressionRatio: 0,
      entryCount: 0,
    });
  });

  // ---- Small context bypass -----------------------------------------------

  it('skips compression for contexts shorter than 500 chars', async () => {
    const tiny: ContextEntry[] = [
      { title: 'Short', date: '2025-01-01', content: 'Just a tiny note.' },
    ];

    const result = await service.compress('question', tiny);

    expect(result.entries).toEqual(tiny);
    expect(result.metrics.compressionRatio).toBe(0);
    // getAI should never have been called.
    expect(getAI).not.toHaveBeenCalled();
  });

  // ---- Successful compression ---------------------------------------------

  it('compresses entries and returns valid metrics on success', async () => {
    const compressed: ContextEntry[] = [
      {
        title: 'A long walk home',
        date: '2025-12-01',
        content:
          'Walked through park. Golden leaves, cool air — felt peace and gratitude. ' +
          'Met Maya at coffee shop; she starts at Meridian Corp Jan 15th. Happy for ' +
          'her but felt career envy. Beautiful sunset. Resolved to walk more.',
      },
      {
        title: 'Late-night thoughts',
        date: '2025-12-02',
        content:
          'Insomnia. Anxious about Dec 20th deadline. Tried 4-7-8 breathing (Dr. Patel). ' +
          'Journaled 20 min, calmed down. Plan: break project into smaller tasks, ask Sam for data analysis help.',
      },
    ];

    mockAI(JSON.stringify(compressed));

    const result = await service.compress('How have I been feeling?', sampleEntries);

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].title).toBe('A long walk home');
    expect(result.entries[0].date).toBe('2025-12-01');
    expect(result.entries[1].title).toBe('Late-night thoughts');
    expect(result.entries[1].date).toBe('2025-12-02');

    // Compression ratio should be > 0
    expect(result.metrics.compressionRatio).toBeGreaterThan(0);
    expect(result.metrics.entryCount).toBe(2);
    expect(result.metrics.compressedChars).toBeLessThan(result.metrics.originalChars);
  });

  // ---- Preserves facts, dates, emotions -----------------------------------

  it('compressed output preserves key facts and dates', async () => {
    const compressed: ContextEntry[] = [
      {
        title: 'A long walk home',
        date: '2025-12-01',
        content:
          'Park walk. Met Maya — starts Meridian Corp January 15th. Felt peace, gratitude, career envy.',
      },
      {
        title: 'Late-night thoughts',
        date: '2025-12-02',
        content:
          'Insomnia. Dec 20th deadline anxiety. 4-7-8 breathing (Dr. Patel). Ask Sam for data help.',
      },
    ];

    mockAI(JSON.stringify(compressed));

    const result = await service.compress('What happened with Maya?', sampleEntries);

    // Facts preserved
    expect(result.entries[0].content).toContain('Maya');
    expect(result.entries[0].content).toContain('Meridian Corp');
    expect(result.entries[0].content).toContain('January 15th');

    // Dates preserved
    expect(result.entries[1].content).toContain('Dec 20th');

    // Names preserved
    expect(result.entries[1].content).toContain('Dr. Patel');
    expect(result.entries[1].content).toContain('Sam');

    // Emotions preserved
    expect(result.entries[0].content).toContain('peace');
    expect(result.entries[1].content).toContain('anxiety');
  });

  // ---- Fallback on API failure --------------------------------------------

  it('falls back to original entries when Gemini API fails', async () => {
    mockAIFailure(new Error('Rate limited'));

    const result = await service.compress('question', sampleEntries);

    expect(result.entries).toEqual(sampleEntries);
    expect(result.metrics.compressionRatio).toBe(0);
    expect(result.metrics.originalChars).toBe(result.metrics.compressedChars);
  });

  // ---- Fallback on malformed response -------------------------------------

  it('falls back to original entries when API returns malformed JSON', async () => {
    mockAI('this is not valid JSON');

    const result = await service.compress('question', sampleEntries);

    expect(result.entries).toEqual(sampleEntries);
    expect(result.metrics.compressionRatio).toBe(0);
  });

  // ---- Fallback on wrong entry count --------------------------------------

  it('falls back when compressed array length mismatches input count', async () => {
    // Return only 1 entry instead of the expected 2.
    const wrong = [
      {
        title: 'A long walk home',
        date: '2025-12-01',
        content: 'Compressed content.',
      },
    ];
    mockAI(JSON.stringify(wrong));

    const result = await service.compress('question', sampleEntries);

    expect(result.entries).toEqual(sampleEntries);
    expect(result.metrics.compressionRatio).toBe(0);
  });

  // ---- Fallback on missing required fields --------------------------------

  it('falls back when compressed entries are missing required fields', async () => {
    const bad = [
      { title: 'A long walk home', date: '2025-12-01' }, // no content
      { title: 'Late-night thoughts', content: 'stuff' }, // no date
    ];
    mockAI(JSON.stringify(bad));

    const result = await service.compress('question', sampleEntries);

    expect(result.entries).toEqual(sampleEntries);
    expect(result.metrics.compressionRatio).toBe(0);
  });
});
