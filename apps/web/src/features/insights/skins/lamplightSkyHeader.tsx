import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { LamplightSky } from '@/features/landing/heroes/lamplightSky';
import { useDeviceWorld } from '@/lib/theme';
import { moonNameLower, moonPhase } from '@/lib/sky';

/**
 * Lamplight's Insights header: the page title over a quiet live sky (local-time stars and
 * tonight's true moon). Wrap the existing heading block:
 *
 *   <LamplightSkyHeader>
 *     <h1>Insights</h1> <p>…</p>
 *   </LamplightSkyHeader>
 *
 * In any other world it renders its children untouched. The sky sits behind the text and only
 * adds faint stars at the edges; the moon's name is real text for screen readers and sighted
 * readers alike.
 */
const MOON_AT = { x: 0.94, y: 0.3 };

export function LamplightSkyHeader({ children, className, date }: { children: ReactNode; className?: string; date?: Date }) {
  const world = useDeviceWorld();
  if (world !== 'lamplight') return <>{children}</>;
  const phase = moonPhase(date ?? new Date());
  const lit = Math.round(phase.illuminated * 100);
  return (
    <header className={clsx('relative isolate -mx-4 overflow-hidden px-4 pb-6 sm:-mx-8 sm:px-8', className)}>
      <LamplightSky date={date} moonAt={MOON_AT} moonRadius={15} density={1.6} className="-z-10 [mask-image:linear-gradient(to_bottom,black_55%,transparent)]" />
      {children}
      <p className="mt-3 text-xs text-fg-faint">
        Tonight: {moonNameLower(phase)}, {lit}% lit
      </p>
    </header>
  );
}
