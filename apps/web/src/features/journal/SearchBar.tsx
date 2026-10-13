import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { LIMITS } from '@solace/shared';
import { Tabs } from '@/components/ui';
import type { SearchMode } from '../journal-core/queries';

type Props = {
  q: string;
  mode: SearchMode;
  onQuery: (q: string) => void;
  onMode: (m: SearchMode) => void;
};

/** One search box; typing settles for 350ms before searching, Enter searches now. */
export function SearchBar({ q, mode, onQuery, onMode }: Props) {
  const [value, setValue] = useState(q);
  const last = useRef(q);
  const input = useRef<HTMLInputElement>(null);

  // Back/forward navigation changes ?q= underneath us.
  useEffect(() => {
    if (q !== last.current) {
      last.current = q;
      setValue(q);
    }
  }, [q]);

  useEffect(() => {
    if (value.trim() === last.current.trim()) return;
    const t = setTimeout(() => {
      last.current = value;
      onQuery(value);
    }, 350);
    return () => clearTimeout(t);
  }, [value, onQuery]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <form
        role="search"
        className="relative min-w-0 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          last.current = value;
          onQuery(value);
        }}
      >
        <label htmlFor="journal-search" className="sr-only">
          Search your journal
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-faint" aria-hidden="true" />
        <input
          ref={input}
          id="journal-search"
          type="search"
          value={value}
          maxLength={LIMITS.searchQueryMax}
          onChange={(e) => setValue(e.target.value)}
          placeholder={mode === 'hybrid' ? 'Search by what it was about…' : 'Search for exact words…'}
          autoComplete="off"
          enterKeyHint="search"
          className="h-12 w-full rounded-control border border-line bg-sunken pr-11 pl-10 text-base text-fg placeholder:text-fg-faint hover:border-line-strong [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setValue('');
              last.current = '';
              onQuery('');
              input.current?.focus();
            }}
            className="absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center rounded-control text-fg-faint hover:text-fg"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </form>
      <Tabs
        label="Search mode"
        value={mode}
        onValueChange={(v) => onMode(v as SearchMode)}
        items={[
          { value: 'hybrid', label: 'By meaning' },
          { value: 'keyword', label: 'Exact words' },
        ]}
        className="self-start sm:self-auto"
      />
    </div>
  );
}
