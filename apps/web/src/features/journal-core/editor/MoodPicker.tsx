import { memo } from 'react';
import { clsx } from 'clsx';
import { MOODS, type Mood } from '@solace/shared';
import { MoodDot } from '@/components/ui';
import { moodLabel } from '../format';
import type { MoodSource } from './syncEngine';

type Props = {
  mood: Mood | null;
  source: MoodSource;
  onChange: (mood: Mood | null) => void;
};

/**
 * Ten moods as chips. A mood Solace inferred (source 'ai') is shown as a suggestion in
 * the AI colour; accepting or picking any chip makes it the user's own.
 */
export const MoodPicker = memo(function MoodPicker({ mood, source, onChange }: Props) {
  const suggested = source === 'ai' ? mood : null;
  const chosen = source === 'user' ? mood : null;
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-medium text-fg-muted">How did this day feel?</legend>
      {suggested && (
        <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ai">
          <span>
            Solace sensed: <span className="font-medium">{suggested}</span>
          </span>
          <button
            type="button"
            onClick={() => onChange(suggested)}
            className="relative rounded-control font-medium underline decoration-ai/50 underline-offset-2 hover:decoration-ai after:absolute after:-inset-3 after:content-['']"
          >
            That’s right
          </button>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {MOODS.map((m) => {
          const isChosen = chosen === m;
          const isSuggested = suggested === m;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={isChosen}
              onClick={() => onChange(isChosen ? null : m)}
              className={clsx(
                'inline-flex h-11 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors sm:h-9',
                isChosen
                  ? 'border-accent/60 bg-accent-soft text-fg'
                  : isSuggested
                    ? 'border-ai/50 bg-ai-soft text-fg'
                    : 'border-line text-fg-muted hover:border-line-strong hover:text-fg',
              )}
            >
              <span aria-hidden="true" className="inline-flex"><MoodDot mood={m} size={9} /></span>
              {moodLabel(m)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
});
