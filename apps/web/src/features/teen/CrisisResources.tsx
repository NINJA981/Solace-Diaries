import { Phone } from 'lucide-react';
import { useId } from 'react';
import { buttonClasses } from '@/components/ui/Button';
import {
  CRISIS_LAST_REVIEWED,
  EMERGENCY_NUMBERS,
  HELPLINES,
  REGION_LABELS,
  REGION_ORDER,
} from './crisis-data';

/**
 * Help lines, calm and one tap away. Safe to mount anywhere (Settings, Reflect, the teen
 * screens). `headingLevel` is the level of its own heading, so it nests under the page's.
 */
export function CrisisResources({
  headingLevel = 2,
  title = 'Need to talk to someone?',
  className,
}: {
  headingLevel?: 2 | 3 | 4;
  title?: string;
  className?: string;
}) {
  const id = useId();
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const Sub = `h${Math.min(headingLevel + 1, 6)}` as 'h3' | 'h4' | 'h5';
  return (
    <section aria-labelledby={`${id}-title`} className={className} data-testid="crisis-resources">
      <H id={`${id}-title`} className="type-heading text-xl leading-snug text-fg">
        {title}
      </H>
      <p className="mt-2 max-w-prose leading-relaxed text-fg-muted">
        You don’t have to carry hard things alone. These services are free and private, and the people on the
        other end are glad you reached out. If you are in danger right now, call your local emergency number (
        {EMERGENCY_NUMBERS}).
      </p>
      <div className="mt-5 flex flex-col gap-6">
        {REGION_ORDER.map((region) => {
          const items = HELPLINES.filter((h) => h.region === region);
          if (items.length === 0) return null;
          return (
            <div key={region}>
              <Sub className="text-sm font-medium text-fg">{REGION_LABELS[region]}</Sub>
              <ul className="mt-2 flex flex-col gap-3">
                {items.map((h) => (
                  <li
                    key={h.id}
                    className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-fg">{h.name}</p>
                      <p className="mt-0.5 text-sm leading-snug text-fg-muted">{h.about}</p>
                      <p className="mt-1 text-xs text-fg-muted">{h.hours}</p>
                    </div>
                    {h.tel ? (
                      <a
                        href={`tel:${h.tel}`}
                        aria-label={`Call ${h.name} on ${h.number}`}
                        className={buttonClasses('secondary', 'md', 'shrink-0')}
                      >
                        <Phone aria-hidden="true" className="size-4" />
                        {h.number}
                      </a>
                    ) : (
                      <a
                        href={h.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${h.name} (opens in a new tab)`}
                        className={buttonClasses('secondary', 'md', 'shrink-0')}
                      >
                        findahelpline.com
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-5 text-xs text-fg-muted">Numbers last checked {CRISIS_LAST_REVIEWED}.</p>
    </section>
  );
}
