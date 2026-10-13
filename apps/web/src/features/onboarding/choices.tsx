import type { AiStyle } from '@solace/shared';
import { clsx } from 'clsx';
import type { SelectOption } from '@/components/ui/fields';

export const AI_STYLES: { value: AiStyle; label: string; example: string }[] = [
  { value: 'gentle', label: 'Gentle', example: '“That sounds like a heavy week. It makes sense that you wanted more rest.”' },
  { value: 'direct', label: 'Direct', example: '“You’ve mentioned poor sleep in four entries this month. Earlier nights helped in March.”' },
  { value: 'curious', label: 'Curious', example: '“What was different about the days you felt rested?”' },
  { value: 'stoic', label: 'Stoic', example: '“The week was hard. Which part of it was in your control?”' },
];

function hourLabel(h: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2024, 0, 1, h));
}

export const REMINDER_OPTIONS: SelectOption[] = [
  { value: '', label: 'No reminder' },
  ...Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: hourLabel(h) })),
];

export function AiStylePicker({ value, onChange, name = 'ai-style' }: { value: AiStyle; onChange: (v: AiStyle) => void; name?: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {AI_STYLES.map((style) => {
        const checked = value === style.value;
        return (
          <label
            key={style.value}
            className={clsx(
              'relative flex cursor-pointer flex-col gap-2 rounded-card border p-4 transition-colors',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
              checked ? 'border-dusk/70 bg-dusk-soft' : 'border-line bg-surface hover:border-line-strong',
            )}
          >
            <input
              type="radio"
              name={name}
              value={style.value}
              checked={checked}
              onChange={() => onChange(style.value)}
              className="sr-only"
            />
            <span className="flex items-center justify-between gap-3">
              <span className="font-medium text-fg">{style.label}</span>
              <span
                aria-hidden="true"
                className={clsx(
                  'grid size-4 place-items-center rounded-full border',
                  checked ? 'border-dusk bg-dusk' : 'border-line-strong',
                )}
              >
                {checked && <span className="size-1.5 rounded-full bg-ink" />}
              </span>
            </span>
            <span className="font-serif text-[0.975rem] leading-snug text-fg-muted italic">{style.example}</span>
          </label>
        );
      })}
    </div>
  );
}
