import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { WORLD_ORDER, worlds, type WorldId } from '@/worlds';
import type { ThemeName } from '@/worlds/types';

/**
 * A real, miniature Today screen drawn in a world's own tokens: the subtree carries
 * data-world/data-theme, so every utility inside resolves that world's colours, type, radius
 * and texture. Decorative: the radio's label and description carry the meaning.
 */
export function WorldPreview({ id, theme, className }: { id: WorldId; theme: ThemeName; className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-world={id}
      data-theme={theme}
      className={clsx('world-texture overflow-hidden rounded-card border border-line bg-canvas p-3 text-left text-fg', className)}
    >
      <p className="type-heading text-lg leading-tight">Good evening, Sam</p>
      <p className="mt-0.5 text-caption text-fg-muted">4 days in a row.</p>
      <div className="mt-2.5 rounded-control border border-ai/25 bg-ai-soft px-2.5 py-2">
        <p className="text-caption font-medium text-ai">A question for today</p>
        <p className="mt-0.5 type-heading text-sm leading-snug">What did you notice that you usually walk past?</p>
      </div>
      <p className="mt-2.5 line-clamp-2 font-prose text-xs leading-relaxed text-fg-muted">
        The lake again this morning. Flat, silver, quiet. A heron stood in the reeds the whole time.
      </p>
      <div className="mt-2.5 flex items-center gap-1.5">
        <span className="inline-flex h-6 items-center rounded-control bg-accent px-2.5 text-caption font-medium text-accent-fg inset-shadow-highlight">
          Save
        </span>
        <span className="inline-flex h-6 items-center gap-1 rounded-pill border border-line-strong px-2 text-caption text-fg-muted">
          <span className="size-1.5 rounded-full bg-mood-4" />
          Calm
        </span>
        <span className="ml-auto inline-flex h-6 items-center gap-1 text-caption text-fg-faint">
          <Check className="size-3" />
          Saved
        </span>
      </div>
    </div>
  );
}

type Props = {
  value: WorldId;
  onChange: (id: WorldId) => void;
  /** Theme the previews are drawn in. */
  theme: ThemeName;
  name?: string;
  className?: string;
};

/**
 * Pick a world: four live previews as a radio group. Fonts for a world load as soon as its
 * card is hovered or focused, so the preview (and the switch) shows the real type.
 */
export function WorldPicker({ value, onChange, theme, name = 'world', className }: Props) {
  return (
    <div className={clsx('grid gap-3 sm:grid-cols-2', className)}>
      {WORLD_ORDER.map((id) => {
        const world = worlds[id];
        const checked = value === id;
        const warm = () => void world.loadFonts().catch(() => {});
        return (
          <label
            key={id}
            onPointerEnter={warm}
            className={clsx(
              'group relative flex cursor-pointer flex-col gap-3 rounded-card border p-2 transition-colors',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
              checked ? 'border-accent/70 bg-accent-soft' : 'border-line bg-surface hover:border-line-strong',
            )}
          >
            <input
              type="radio"
              name={name}
              value={id}
              checked={checked}
              onChange={() => onChange(id)}
              onFocus={warm}
              className="sr-only"
            />
            <WorldPreview id={id} theme={theme} />
            <span className="flex items-start justify-between gap-3 px-1.5 pb-1">
              <span className="min-w-0">
                <span className="block font-medium text-fg">{world.name}</span>
                <span className="mt-0.5 block text-sm leading-snug text-fg-muted">{world.description}</span>
              </span>
              <span
                aria-hidden="true"
                className={clsx(
                  'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border',
                  checked ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong',
                )}
              >
                {checked && <Check className="size-3" strokeWidth={3} />}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
