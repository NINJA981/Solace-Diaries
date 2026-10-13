import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { clsx } from 'clsx';
import { Plus, Trash } from 'lucide-react';
import type { Thread } from '@solace/shared';
import { ConfirmDialog, toast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { InlineError } from '../journal-core/EntryCard';
import { useDeleteThread, useThreads } from '../journal-core/queries';

function when(iso: string): string {
  const d = new Date(iso);
  const days = (Date.now() - d.getTime()) / 86_400_000;
  if (days < 1 && new Date().getDate() === d.getDate()) return 'Today';
  if (days < 7) return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(d);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d);
}

/** Past reflections. Lives in a sidebar on desktop and a sheet on mobile. */
export function ThreadList({ activeId, onNavigate }: { activeId?: string; onNavigate?: () => void }) {
  const threads = useThreads();
  const del = useDeleteThread();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState<Thread | null>(null);

  return (
    <nav aria-label="Past reflections" className="flex min-h-0 flex-col">
      <NavLink
        to="/app/reflect"
        end
        onClick={onNavigate}
        className="mb-3 inline-flex h-11 items-center gap-2 rounded-control border border-line px-3 text-sm font-medium text-fg transition-colors hover:border-line-strong sm:h-10"
      >
        <Plus className="size-4" aria-hidden="true" />
        New reflection
      </NavLink>
      {threads.isPending ? (
        <ul aria-hidden="true" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-9 animate-pulse rounded-control bg-sunken" />
          ))}
        </ul>
      ) : threads.isError ? (
        <InlineError message="Couldn’t load past reflections." onRetry={() => void threads.refetch()} />
      ) : threads.data.length === 0 ? (
        <p className="px-1 text-sm leading-relaxed text-fg-faint">Your conversations with Solace will be kept here.</p>
      ) : (
        <ul className="-mx-1 min-h-0 space-y-0.5 overflow-y-auto">
          {threads.data.map((t) => (
            <li key={t.id} className="group relative">
              <NavLink
                to={`/app/reflect/${t.id}`}
                onClick={onNavigate}
                className={({ isActive }) =>
                  clsx(
                    'flex min-h-11 flex-col justify-center rounded-control py-1.5 pr-11 pl-3 transition-colors',
                    isActive || t.id === activeId ? 'bg-raised text-fg' : 'text-fg-muted hover:bg-surface hover:text-fg',
                  )
                }
              >
                <span className="truncate text-sm">{t.title.trim() || 'Untitled reflection'}</span>
                <span className="text-xs text-fg-faint">{when(t.updatedAt)}</span>
              </NavLink>
              <button
                type="button"
                aria-label={`Delete reflection “${t.title.trim() || 'Untitled reflection'}”`}
                onClick={() => setDeleting(t)}
                className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-control text-fg-faint opacity-100 transition-opacity hover:bg-sunken hover:text-danger focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
              >
                <Trash className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this reflection?"
        description="The conversation will be removed. Your journal entries aren’t affected."
        confirmLabel="Delete reflection"
        tone="danger"
        onConfirm={async () => {
          if (!deleting) return;
          const id = deleting.id;
          try {
            await del.mutateAsync(id);
            setDeleting(null);
            toast('Reflection deleted');
            if (id === activeId) navigate('/app/reflect');
          } catch (err) {
            toast(errorMessage(err), { tone: 'danger' });
          }
        }}
      />
    </nav>
  );
}
