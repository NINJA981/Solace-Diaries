import { MOOD_SCORE, type Mood } from '@solace/shared';
import { clsx } from 'clsx';

/** -2..2 valence → 1..5 on the mood ramp. */
export function moodLevel(mood: Mood): 1 | 2 | 3 | 4 | 5 {
  return (MOOD_SCORE[mood] + 3) as 1 | 2 | 3 | 4 | 5;
}

export function MoodDot({ mood, size = 10, className }: { mood: Mood | null; size?: number; className?: string }) {
  const label = mood ? `Mood: ${mood}` : 'No mood recorded';
  return (
    <span
      role="img"
      aria-label={label}
      title={mood ?? undefined}
      className={clsx('inline-block shrink-0 rounded-full', !mood && 'border border-fg-faint', className)}
      style={{
        width: size,
        height: size,
        background: mood ? `var(--mood-${moodLevel(mood)})` : 'transparent',
      }}
    />
  );
}
