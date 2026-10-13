import type { ComponentType } from 'react';

type Loader = () => Promise<{ default: ComponentType }>;

/** Lazy loaders for the signed-in pages, shared by the router and nav prefetching. */
export const appPages = {
  today: () => import('@/features/today/TodayPage'),
  entry: () => import('@/features/today/EntryPage'),
  journal: () => import('@/features/journal/JournalPage'),
  reflect: () => import('@/features/reflect/ReflectPage'),
  insights: () => import('@/features/insights/InsightsPage'),
  settings: () => import('@/features/settings/SettingsPage'),
} satisfies Record<string, Loader>;

const byPath: Record<string, Loader> = {
  '/app/today': appPages.today,
  '/app/journal': appPages.journal,
  '/app/reflect': appPages.reflect,
  '/app/insights': appPages.insights,
  '/app/settings': appPages.settings,
};

/** Warm a page's chunk when its link is hovered or focused, so navigation feels instant. */
export function prefetchPage(path: string): void {
  void byPath[path]?.().catch(() => {});
}
