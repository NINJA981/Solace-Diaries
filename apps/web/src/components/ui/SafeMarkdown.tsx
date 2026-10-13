import { clsx } from 'clsx';
import Markdown, { type Components } from 'react-markdown';

/** Only absolute http(s) and mailto URLs survive; everything else (javascript:, data:, relative) is dropped. */
export function safeUrl(url: string): string | undefined {
  const trimmed = url.trim();
  if (!/^(https?:|mailto:)/i.test(trimmed)) return undefined;
  try {
    const parsed = new URL(trimmed);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

const components: Components = {
  // Images could exfiltrate data via their URL; never render them.
  img: () => null,
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
};

/**
 * Renders AI- or user-authored Markdown safely: raw HTML skipped, images removed, links
 * limited to http(s)/mailto and opened in a new tab without referrer.
 */
export function SafeMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={clsx('md', className)}>
      <Markdown skipHtml components={components} urlTransform={(url) => safeUrl(url)}>
        {children}
      </Markdown>
    </div>
  );
}
