import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Citation } from '@solace/shared';
import { Answer } from './Messages';
import { CITE_PREFIX } from './citations';

const cite: Citation = {
  n: 1,
  entryId: '00000000-0000-4000-8000-000000000001',
  title: 'By the sea',
  entryDate: '2026-10-01',
  snippet: 'calm',
};

describe('Reflect answer links', () => {
  it('keeps citation markers clickable and renders every other link as plain text', () => {
    const content =
      'You felt calm by the sea [1]. [Read more](https://evil.example/collect?d=my-secret) ' +
      'or <https://evil.example/auto> or [mail](mailto:x@evil.example).';
    const { container } = render(
      <MemoryRouter>
        <Answer content={content} citations={[cite]} today="2026-10-13" idBase="m1" />
      </MemoryRouter>,
    );
    const answer = container.querySelector('.solace-answer')!;
    const hrefs = Array.from(answer.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([`${CITE_PREFIX}1`]);
    expect(answer.innerHTML).not.toMatch(/href="[^"]*evil/);
    expect(answer.innerHTML).not.toContain('my-secret');
    expect(answer.textContent).toContain('Read more');
  });
});
