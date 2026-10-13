import { BookOpen, Feather, MessagesSquare, Telescope, type LucideIcon } from 'lucide-react';

export type NavItem = { to: string; label: string; icon: LucideIcon; /** extra path prefixes that count as this section */ also?: string[] };

export const NAV_ITEMS: NavItem[] = [
  { to: '/app/today', label: 'Today', icon: Feather },
  { to: '/app/journal', label: 'Journal', icon: BookOpen, also: ['/app/entries/'] },
  { to: '/app/reflect', label: 'Reflect', icon: MessagesSquare },
  { to: '/app/insights', label: 'Insights', icon: Telescope },
];

export function isActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.to || pathname.startsWith(`${item.to}/`)) return true;
  return item.also?.some((p) => pathname.startsWith(p)) ?? false;
}

/** Where "New entry" goes. Today owns the editor; `?new=1` asks it to start a fresh entry. */
export const NEW_ENTRY_PATH = '/app/today?new=1';
