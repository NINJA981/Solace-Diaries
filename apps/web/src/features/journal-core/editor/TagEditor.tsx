import { memo, useId, useState } from 'react';
import { X } from 'lucide-react';
import { LIMITS } from '@solace/shared';

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#/, '').replace(/\s+/g, ' ').toLowerCase().slice(0, LIMITS.tagMax);
}

/** Tags as removable chips plus an input (Enter or comma adds). Solace adds its own after reading. */
export const TagEditor = memo(function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const id = useId();
  const full = tags.length >= LIMITS.tagsMax;

  const add = (raw: string) => {
    const parts = raw.split(',').map(normalizeTag).filter(Boolean);
    if (!parts.length) return;
    const next = [...tags];
    for (const t of parts) {
      if (next.length >= LIMITS.tagsMax) {
        setNote(`An entry can have up to ${LIMITS.tagsMax} tags.`);
        break;
      }
      if (!next.includes(t)) next.push(t);
    }
    onChange(next);
    setValue('');
  };

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-fg-muted">
        Tags
      </label>
      <ul className="flex flex-wrap items-center gap-2" aria-label="Tags on this entry">
        {tags.map((t) => (
          <li key={t}>
            <span className="inline-flex h-9 items-center gap-1 rounded-full border border-line bg-sunken pr-1 pl-3 text-sm text-fg">
              {t}
              <button
                type="button"
                aria-label={`Remove tag ${t}`}
                onClick={() => {
                  onChange(tags.filter((x) => x !== t));
                  setNote('');
                }}
                className="relative grid size-7 place-items-center rounded-full text-fg-faint hover:bg-raised hover:text-fg after:absolute after:-inset-2 after:content-['']"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
        <li className="min-w-[10rem] flex-1">
          <input
            id={id}
            value={value}
            disabled={full}
            maxLength={LIMITS.tagMax * 3}
            placeholder={full ? 'Tag limit reached' : tags.length ? 'Add another' : 'Add a tag'}
            onChange={(e) => {
              const v = e.target.value;
              if (v.includes(',')) add(v);
              else setValue(v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(value);
              }
            }}
            onBlur={() => value && add(value)}
            className="h-11 w-full rounded-control border border-transparent bg-transparent px-2 text-sm text-fg placeholder:text-fg-faint hover:border-line focus:border-line-strong sm:h-9"
          />
        </li>
      </ul>
      {note && (
        <p className="mt-1 text-xs text-fg-faint" role="status">
          {note}
        </p>
      )}
    </div>
  );
});
