import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

type Zone = { value: string; label: string; offset: string; search: string };

function offsetOf(zone: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? '';
  } catch {
    return '';
  }
}

let cached: Zone[] | null = null;
export function allTimezones(): Zone[] {
  if (cached) return cached;
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC', 'Europe/London', 'America/New_York'];
  const values = supported.includes('UTC') ? supported : ['UTC', ...supported];
  cached = values.map((value) => {
    const label = value.replaceAll('_', ' ').replaceAll('/', ' / ');
    const offset = offsetOf(value);
    return { value, label, offset, search: `${value} ${label} ${offset}`.toLowerCase() };
  });
  return cached;
}

export function timezoneLabel(value: string): string {
  const zone = allTimezones().find((z) => z.value === value);
  return zone ? `${zone.label}${zone.offset ? ` (${zone.offset})` : ''}` : value;
}

/** Searchable timezone picker (ARIA combobox + listbox). */
export function TimezoneSelect({
  value,
  onChange,
  label = 'Timezone',
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const hintId = hint ? `${id}-hint` : undefined;
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const zones = allTimezones();

  const results = useMemo(() => {
    const q = (query ?? '').trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const matched = terms.length ? zones.filter((z) => terms.every((t) => z.search.includes(t))) : zones;
    return matched.slice(0, 60);
  }, [query, zones]);

  const commit = (zone: Zone | undefined) => {
    if (!zone) return;
    onChange(zone.value);
    setQuery(null);
    setOpen(false);
  };

  const move = (delta: number) => {
    setOpen(true);
    setActive((i) => {
      const next = Math.max(0, Math.min(results.length - 1, i + delta));
      requestAnimationFrame(() => listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' }));
      return next;
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      commit(results[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
      setQuery(null);
    }
  };

  const display = query ?? timezoneLabel(value);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${id}-opt-${active}` : undefined}
          aria-describedby={hintId}
          autoComplete="off"
          spellCheck={false}
          value={display}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setQuery(null);
          }}
          onKeyDown={onKeyDown}
          className="h-10 w-full rounded-control border border-control-edge bg-sunken px-3 max-sm:min-h-11 text-base text-fg placeholder:text-fg-faint hover:border-fg-muted focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
          placeholder="Search for a city or region"
        />
        {open && (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            className="absolute inset-x-0 top-full z-40 mt-1 max-h-64 overflow-y-auto overscroll-contain rounded-card border border-line bg-raised p-1 shadow-2"
          >
            {results.length === 0 && <li className="px-3 py-2.5 text-sm text-fg-muted">No timezone matches “{query}”.</li>}
            {results.map((zone, i) => (
              <li
                key={zone.value}
                id={`${id}-opt-${i}`}
                data-index={i}
                role="option"
                aria-selected={zone.value === value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(zone);
                }}
                onMouseMove={() => setActive(i)}
                className={clsx(
                  'flex cursor-pointer items-center gap-3 rounded-control px-3 py-2 text-sm',
                  i === active ? 'bg-sunken text-fg' : 'text-fg-muted',
                )}
              >
                <span className="grid size-4 place-items-center text-accent">{zone.value === value && <Check aria-hidden="true" className="size-4" />}</span>
                <span className="min-w-0 flex-1 truncate">{zone.label}</span>
                <span className="shrink-0 text-xs text-fg-faint">{zone.offset}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {hint && (
        <p id={hintId} className="text-xs leading-snug text-fg-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
