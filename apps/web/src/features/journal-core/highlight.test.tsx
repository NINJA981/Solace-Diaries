import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { highlight, queryTerms } from './highlight';
import { Highlighted } from './Highlighted';

describe('highlight', () => {
  it('splits on query terms case-insensitively', () => {
    expect(highlight('I went Running, then ran home', 'running ran')).toEqual([
      { text: 'I went ', match: false },
      { text: 'Running', match: true },
      { text: ', then ', match: false },
      { text: 'ran', match: true },
      { text: ' home', match: false },
    ]);
  });

  it('treats regex characters in the query literally', () => {
    // Edge punctuation is trimmed; inner regex characters must match literally.
    expect(highlight('cost (approx) $5x00 or $5.00', '(approx) $5.00')).toEqual([
      { text: 'cost (', match: false },
      { text: 'approx', match: true },
      { text: ') $5x00 or $', match: false },
      { text: '5.00', match: true },
    ]);
    expect(() => highlight('a.b', '.*[')).not.toThrow();
  });

  it('keeps quoted phrases whole and drops stop words', () => {
    expect(queryTerms('"long walk" the and by me sea')).toEqual(['long walk', 'sea', 'by']);
  });

  it('renders markup in snippets as text, never HTML', () => {
    const { container } = render(
      <p>
        <Highlighted text={'<img src=x onerror=alert(1)> my <b>walk</b>'} query="walk" />
      </p>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelectorAll('mark')).toHaveLength(1);
    expect(container.textContent).toBe('<img src=x onerror=alert(1)> my <b>walk</b>');
  });
});
