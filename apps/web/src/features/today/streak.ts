/** The streak count to show: teen mode never shows one. */
export function visibleStreak(mode: 'adult' | 'teen' | undefined, streak: number | undefined): number {
  return mode === 'teen' ? 0 : (streak ?? 0);
}
