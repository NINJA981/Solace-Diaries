import type { ThreadMode } from '@solace/shared';

export const MODE_OPTIONS: { mode: ThreadMode; label: string; description: string }[] = [
  { mode: 'open', label: 'Open conversation', description: 'Ask anything about your journal.' },
  { mode: 'gratitude', label: 'Gratitude', description: 'Notice what has been good lately, in your own words.' },
  { mode: 'reframe', label: 'Reframe a worry', description: 'Look at a worry from a kinder, steadier angle.' },
  { mode: 'unsent_letter', label: 'Unsent letter', description: 'Say what you need to say to someone, without sending it.' },
  { mode: 'sunday_review', label: 'Sunday review', description: 'Look back over the week and set a gentle intention.' },
];

/** The label shown in a thread header; open conversations show nothing extra. */
export function modeLabel(mode: ThreadMode | undefined): string | null {
  if (!mode || mode === 'open') return null;
  return MODE_OPTIONS.find((m) => m.mode === mode)?.label ?? null;
}

/** The createThread body for a mode: open conversations send no mode at all. */
export function createThreadPayload(mode: ThreadMode, title?: string): { title?: string; mode?: ThreadMode } {
  const out: { title?: string; mode?: ThreadMode } = {};
  const t = title?.trim();
  if (t) out.title = t.length > 80 ? `${t.slice(0, 77)}…` : t;
  if (mode !== 'open') out.mode = mode;
  return out;
}
