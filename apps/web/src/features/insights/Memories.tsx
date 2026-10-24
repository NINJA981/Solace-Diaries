import { useId, useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Pencil, Trash } from 'lucide-react';
import { LIMITS, MEMORY_KINDS, type Memory, type MemoryKind } from '@solace/shared';
import { Button, ConfirmDialog, EmptyState, IconButton, Skeleton, Tabs, toast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useVoice, voiceNow } from '@/lib/voice';
import { InlineError } from '../journal-core/EntryCard';
import { plural } from '../journal-core/format';
import { useTeenFlags } from '../teen/flags';
import { useDeleteMemory, useMemories, useUpdateMemory, type MemoryStatus } from '../journal-core/queries';
import '../journal-core/journal.css';

const KIND_TITLE: Record<MemoryKind, string> = {
  person: 'People',
  place: 'Places',
  goal: 'Goals',
  habit: 'Habits',
  pattern: 'Patterns',
  fact: 'Facts',
  feeling: 'Feelings',
};

function seen(m: Memory): string {
  const n = m.sourceEntryIds.length;
  const last = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(m.lastSeen));
  return `${n ? `From ${plural(n, 'entry', 'entries')}` : 'From your entries'}, last noticed ${last}`;
}

function MemoryItem({ m, status }: { m: Memory; status: MemoryStatus }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const [confirming, setConfirming] = useState(false);
  const update = useUpdateMemory();
  const del = useDeleteMemory();
  const fieldId = useId();

  const save = () => {
    const content = draft.trim();
    if (!content || content === m.content) {
      setEditing(false);
      return;
    }
    update.mutate(
      { id: m.id, patch: { content } },
      {
        onSuccess: () => {
          setEditing(false);
          toast(voiceNow().memoryUpdated);
        },
        onError: (err) => toast(errorMessage(err), { tone: 'danger' }),
      },
    );
  };
  const setStatus = (next: MemoryStatus) =>
    update.mutate(
      { id: m.id, patch: { status: next } },
      {
        onSuccess: () => toast(next === 'archived' ? 'Memory archived' : 'Memory restored'),
        onError: (err) => toast(errorMessage(err), { tone: 'danger' }),
      },
    );

  return (
    <li className="group flex items-start gap-3 border-t border-line py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label htmlFor={fieldId} className="sr-only">
              Edit memory
            </label>
            <textarea
              id={fieldId}
              value={draft}
              autoFocus
              maxLength={LIMITS.memoryContentMax}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setDraft(m.content);
                  setEditing(false);
                } else if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  save();
                }
              }}
              rows={2}
              className="journal-autogrow w-full resize-none rounded-control border border-line-strong bg-sunken px-3 py-2 font-prose text-base text-fg"
            />
            <div className="mt-2 flex gap-2">
              <Button type="submit" size="sm" loading={update.isPending} className="max-sm:h-11">
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(m.content);
                  setEditing(false);
                }}
                className="max-sm:h-11"
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            <p className="font-prose text-note leading-relaxed text-fg">{m.content}</p>
            <p className="mt-0.5 text-xs text-fg-faint">{seen(m)}</p>
          </>
        )}
      </div>
      {!editing && (
        <div className="flex shrink-0 gap-0.5 md:opacity-0 md:transition-opacity md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          {status === 'active' && (
            <IconButton label="Edit memory" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)} />
          )}
          {status === 'active' ? (
            <IconButton label="Archive memory" icon={<Archive className="size-4" />} onClick={() => setStatus('archived')} disabled={update.isPending} />
          ) : (
            <IconButton label="Restore memory" icon={<ArchiveRestore className="size-4" />} onClick={() => setStatus('active')} disabled={update.isPending} />
          )}
          <IconButton label="Delete memory" icon={<Trash className="size-4" />} onClick={() => setConfirming(true)} />
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this memory?"
        description="Solace will forget it. Your entries stay as they are, so it may notice the same thing again later."
        confirmLabel="Delete memory"
        tone="danger"
        onConfirm={async () => {
          try {
            await del.mutateAsync(m.id);
            setConfirming(false);
            toast(voiceNow().memoryDeleted);
          } catch (err) {
            toast(errorMessage(err), { tone: 'danger' });
          }
        }}
      />
    </li>
  );
}

/** Long-term memories grouped by kind, with the user fully in control. */
export function Memories() {
  const [status, setStatus] = useState<MemoryStatus>('active');
  const q = useMemories(status);
  const voice = useVoice();
  const { peopleMap } = useTeenFlags();
  const groups = useMemo(() => {
    const items = q.data ?? [];
    return MEMORY_KINDS.filter((k) => peopleMap || (k !== 'person' && k !== 'place')).map((k) => ({ kind: k, items: items.filter((m) => m.kind === k) })).filter((g) => g.items.length);
  }, [q.data, peopleMap]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label="Which memories"
          value={status}
          onValueChange={(v) => setStatus(v as MemoryStatus)}
          items={[
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
        {q.data && q.data.length > 0 && <p className="text-xs text-fg-faint">{plural(q.data.length, 'memory', 'memories')}</p>}
      </div>
      {q.isPending ? (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : q.isError ? (
        <InlineError message="Couldn’t load what Solace remembers." onRetry={() => void q.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState
          title={status === 'active' ? voice.memoriesEmptyTitle : 'No archived memories'}
          description={
            status === 'active'
              ? voice.memoriesEmptyBody
              : 'Memories you archive are kept here, out of Solace’s answers, until you restore or delete them.'
          }
        />
      ) : (
        <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
          {groups.map((g) => (
            <section key={g.kind} aria-labelledby={`mem-${g.kind}`}>
              <h3 id={`mem-${g.kind}`} className="mb-1 text-sm font-medium text-ai">
                {KIND_TITLE[g.kind]}
              </h3>
              <ul>
                {g.items.map((m) => (
                  <MemoryItem key={m.id} m={m} status={status} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
