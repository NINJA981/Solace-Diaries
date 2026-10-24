import { clsx } from 'clsx';
import type { CompanionProps } from '@/worlds/types';
import './chromeOrb.css';

export type OrbMood = 'saved' | 'celebrate' | 'idle';

/**
 * Chrome's companion: a polished orb with a holographic rim. It rests slowly, pulses once when an
 * entry is saved, and spins a ring of light when something is worth celebrating. The orb itself is
 * decoration (aria-hidden); the companion's name is real text, spoken in a polite status line
 * when it reacts and shown beside the orb where it has room (onboarding and settings).
 *
 * Re-key the component (`key={saveCount}`) to replay the same reaction twice in a row.
 * Reduced motion: the orb holds still and changes its glow instead of moving.
 */
const SIZE: Record<CompanionProps['placement'], string> = {
  today: 'size-12',
  onboarding: 'size-24',
  settings: 'size-16',
};

const SAYS: Record<OrbMood, string> = { idle: '', saved: 'Saved.', celebrate: 'Nicely done.' };

export function ChromeOrb({ name, placement, mood = 'idle' }: CompanionProps & { mood?: OrbMood }) {
  const label = name.trim() || 'Orb';
  const showName = placement !== 'today';
  return (
    <div className="inline-flex items-center gap-3">
      <span aria-hidden="true" data-mood={mood} className={clsx('chrome-orb relative inline-block shrink-0', SIZE[placement])}>
        <span className="chrome-orb-ring" />
        <span className="chrome-orb-body" />
        <span className="chrome-orb-gloss" />
      </span>
      {showName && <span className="font-mono text-caption text-fg-muted">{label}</span>}
      <span role="status" className="sr-only">
        {SAYS[mood] ? `${label}: ${SAYS[mood]}` : ''}
      </span>
    </div>
  );
}

export default ChromeOrb;
