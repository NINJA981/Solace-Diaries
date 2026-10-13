import { clsx } from 'clsx';
import { useMemo } from 'react';
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

/**
 * Which (already safe) links may stay clickable. Anything rejected renders as plain text.
 * Model output should pass a strict policy: a prompt-injected `[click](https://evil/?q=…)`
 * must not become a one-click exfiltration link.
 */
export type LinkPolicy = (href: string) => boolean;

const allowAll: LinkPolicy = () => true;

function componentsFor(allowLink: LinkPolicy): Components {
  return {
    // Images could exfiltrate data via their URL; never render them.
    img: () => null,
    a: ({ href, children }) =>
      href && allowLink(href) ? (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      ) : (
        <span>{children}</span>
      ),
  };
}

const defaultComponents = componentsFor(allowAll);

/**
 * Renders AI- or user-authored Markdown safely: raw HTML skipped, images removed, links
 * limited to http(s)/mailto and opened in a new tab without referrer. `allowLink` narrows
 * which of those links stay clickable (the rest become plain text).
 */
export function SafeMarkdown({
  children,
  className,
  allowLink,
}: {
  children: string;
  className?: string;
  allowLink?: LinkPolicy;
}) {
  const components = useMemo(() => (allowLink ? componentsFor(allowLink) : defaultComponents), [allowLink]);
  return (
    <div className={clsx('md', className)}>
      <Markdown skipHtml components={components} urlTransform={(url) => safeUrl(url)}>
        {children}
      </Markdown>
    </div>
  );
}
