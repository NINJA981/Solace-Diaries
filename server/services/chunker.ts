/**
 * Sliding window text chunker.
 * Splits text into words by whitespace.
 *
 * Requirements:
 * - Chunk size: 300-500 words.
 * - Chunk overlap: 75 words.
 */
export function chunkText(text: string, minSize = 300, maxSize = 500, overlap = 75): string[] {
  if (!text || !text.trim()) return [];

  const words = text.trim().split(/\s+/);

  if (words.length <= maxSize) {
    return [text.trim()];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < words.length) {
    let end = start + maxSize;
    if (end > words.length) {
      end = words.length;
    }

    // If this is the last chunk and it's too small, shift start back to satisfy minSize
    const chunkLength = end - start;
    if (chunkLength < minSize && end === words.length) {
      start = Math.max(0, end - minSize);
    }

    chunks.push(words.slice(start, end).join(' '));

    if (end === words.length) {
      break;
    }

    start = end - overlap;

    // Safety guard to prevent infinite loops
    if (start <= 0 || start >= words.length) {
      break;
    }
  }

  return chunks;
}
