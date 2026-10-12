/** Minimal Server-Sent Events framing used by the chat stream. */

export function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export type RawSseEvent = { event: string; data: string };

/**
 * Incremental SSE parser: feed it decoded text chunks, it returns complete events and
 * keeps the partial tail buffered between calls.
 */
export function createSseParser() {
  let buffer = '';
  return function push(chunk: string): RawSseEvent[] {
    buffer += chunk.replace(/\r\n/g, '\n');
    const out: RawSseEvent[] = [];
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) out.push({ event, data: data.join('\n') });
    }
    return out;
  };
}
