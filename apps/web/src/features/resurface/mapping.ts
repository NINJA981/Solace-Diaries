import type { ResurfaceItem } from '@solace/shared';

export type RememberCard = {
  id: string;
  kind: ResurfaceItem['kind'];
  date: string;
  title: string;
  excerpt: string;
  reason: string;
};

const ORDER: Record<ResurfaceItem['kind'], number> = { on_this_day: 0, unfinished: 1, echo: 2 };

/** Up to `max` cards for the Today strip: one per entry, "on this day" first, then unfinished threads, then echoes. */
export function toCards(items: readonly ResurfaceItem[] | undefined, max = 3): RememberCard[] {
  const seen = new Set<string>();
  const cards: RememberCard[] = [];
  const sorted = [...(items ?? [])].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  for (const it of sorted) {
    if (seen.has(it.entry.id)) continue;
    seen.add(it.entry.id);
    const title = it.entry.title.trim();
    const excerpt = it.entry.excerpt.trim();
    cards.push({
      id: it.entry.id,
      kind: it.kind,
      date: it.entry.entryDate,
      title: title || excerpt.slice(0, 60) || 'Untitled',
      excerpt: title ? excerpt : '',
      reason: it.reason.trim(),
    });
    if (cards.length >= max) break;
  }
  return cards;
}
