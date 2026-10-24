import { useState } from 'react';
import { Check, Pause, Play, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { localDate, type Intention } from '@solace/shared';
import { Button, ConfirmDialog, Input, Select, Skeleton, toast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { play } from '@/lib/feedback';
import { useProfile, useTimezone } from '@/lib/session';
import { useVoice } from '@/lib/voice';
import { InlineError } from '../journal-core/EntryCard';
import {
  useCreateIntention,
  useDeleteIntention,
  useIntentionSuggestions,
  useIntentions,
  useToggleCheckin,
  useUpdateIntention,
} from '../journal-core/queries-v3b';
import { stripFor, weekCount, weekdayOf } from './weekStrip';

const DISMISSED_KEY = 'solace.dismissedSuggestions';

function readDismissed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const CADENCE_LABEL = { daily: 'Daily', weekly: 'Weekly', none: 'Whenever' } as const;

function WeekStrip({ intention, today, onToggle }: { intention: Intention; today: string; onToggle: (date: string, on: boolean) => void }) {
  const days = stripFor(intention, today);
  return (
    <ol className="flex items-end gap-1.5 sm:gap-2" aria-label={`Last seven days for ${intention.title}`}>
      {days.map((d) => (
        <li key={d.date} className="flex flex-col items-center gap-1">
          <span className="text-micro text-fg-faint" aria-hidden="true">
            {weekdayOf(d.date).slice(0, 2)}
          </span>
          <button
            type="button"
            aria-pressed={d.checked}
            aria-label={`${d.label}${d.isToday ? ', today' : ''}`}
            onClick={() => onToggle(d.date, !d.checked)}
            className={`grid size-11 place-items-center rounded-full border transition-colors sm:size-9 ${
              d.checked ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong bg-transparent text-transparent hover:border-accent/60'
            } ${d.isToday && !d.checked ? 'ring-1 ring-accent/40 ring-offset-2 ring-offset-canvas' : ''}`}
          >
            <Check className="size-4" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ol>
  );
}

function ThreadCard({ intention, today, teen }: { intention: Intention; today: string; teen: boolean }) {
  const toggle = useToggleCheckin();
  const update = useUpdateIntention();
  const remove = useDeleteIntention();
  const [confirm, setConfirm] = useState(false);
  const active = intention.status === 'active';
  const count = weekCount(intention, today);

  const patch = (status: 'active' | 'paused' | 'done') =>
    update.mutate(
      { id: intention.id, patch: { status } },
      { onError: (e) => toast(errorMessage(e), { tone: 'danger' }), onSuccess: () => status === 'done' && play('celebrate') },
    );

  return (
    <li className="rounded-card border border-line bg-surface px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="font-medium text-fg">{intention.title}</h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            {intention.kind === 'goal' ? 'Goal' : 'Habit'} · {CADENCE_LABEL[intention.cadence]}
            {!teen && active && count > 0 ? ` · ${count} of the last 7 days` : ''}
            {intention.status === 'paused' ? ' · Paused' : intention.status === 'done' ? ' · Done' : ''}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {active ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => patch('paused')} icon={<Pause className="size-3.5" aria-hidden="true" />} aria-label={`Pause ${intention.title}`}>
                Pause
              </Button>
              <Button variant="ghost" size="sm" onClick={() => patch('done')} icon={<Check className="size-3.5" aria-hidden="true" />} aria-label={`Mark ${intention.title} as done`}>
                Done
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => patch('active')} icon={<Play className="size-3.5" aria-hidden="true" />} aria-label={`Resume ${intention.title}`}>
              Resume
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setConfirm(true)} icon={<Trash2 className="size-3.5" aria-hidden="true" />} aria-label={`Delete ${intention.title}`}>
            <span className="sr-only">Delete</span>
          </Button>
        </div>
      </div>
      {active && (
        <div className="mt-3">
          <WeekStrip
            intention={intention}
            today={today}
            onToggle={(date, on) => {
              toggle.mutate({ id: intention.id, date, on }, { onError: (e) => toast(errorMessage(e), { tone: 'danger' }) });
              if (on && date === today) play('tap');
            }}
          />
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this thread?"
        description="Its check-ins go with it. Your journal entries aren’t touched."
        confirmLabel="Delete thread"
        tone="danger"
        onConfirm={async () => {
          await remove.mutateAsync(intention.id);
          toast('Thread deleted');
        }}
      />
    </li>
  );
}

function AddForm({ onClose }: { onClose: () => void }) {
  const create = useCreateIntention();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'habit' | 'goal'>('habit');
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'none'>('daily');
  return (
    <form
      className="rounded-card border border-line bg-sunken px-4 py-4 sm:px-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        create.mutate(
          { title: title.trim(), kind, cadence },
          { onSuccess: onClose, onError: (err) => toast(errorMessage(err), { tone: 'danger' }) },
        );
      }}
    >
      <Input label="What would you like to keep coming back to?" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Walk after lunch" autoFocus />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Select
          label="Type"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'habit' | 'goal')}
          options={[
            { value: 'habit', label: 'Habit: something you repeat' },
            { value: 'goal', label: 'Goal: something you work toward' },
          ]}
        />
        <Select
          label="How often"
          value={cadence}
          onChange={(e) => setCadence(e.target.value as 'daily' | 'weekly' | 'none')}
          options={[
            { value: 'daily', label: 'Daily' },
            { value: 'weekly', label: 'Weekly' },
            { value: 'none', label: 'Whenever it fits' },
          ]}
        />
      </div>
      <div className="mt-4 flex gap-2">
        <Button type="submit" size="sm" loading={create.isPending} disabled={!title.trim()}>
          Add thread
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Intentions ("Threads"): a gentle week strip per habit or goal, plus things Solace noticed. */
export function Threads() {
  const tz = useTimezone();
  const today = localDate(new Date(), tz);
  const { profile } = useProfile();
  const teen = profile?.mode === 'teen';
  const voice = useVoice();
  const list = useIntentions();
  const suggestions = useIntentionSuggestions();
  const create = useCreateIntention();
  const [adding, setAdding] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: the dismissal lasts for this visit */
    }
  };

  const items = list.data ?? [];
  const active = items.filter((i) => i.status === 'active');
  const resting = items.filter((i) => i.status !== 'active');
  const offered = (suggestions.data ?? []).filter((s) => !dismissed.includes(s.memoryId) && !items.some((i) => i.memoryId === s.memoryId));

  return (
    <div>
      {list.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-28 rounded-card" />
        </div>
      ) : list.isError ? (
        <InlineError message="Couldn’t load your threads." onRetry={() => void list.refetch()} />
      ) : (
        <>
          {offered.length > 0 && (
            <ul className="mb-4 space-y-2" aria-label="Things Solace noticed">
              {offered.slice(0, 3).map((s) => (
                <li key={s.memoryId} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-ai/30 bg-ai-soft px-4 py-3">
                  <Sparkles className="size-4 shrink-0 text-ai" aria-hidden="true" />
                  <p className="min-w-0 flex-1 text-sm text-fg">
                    Solace noticed you want to <span className="font-medium">{s.title.replace(/^to\s+/i, '')}</span>.
                  </p>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={create.isPending && create.variables?.memoryId === s.memoryId}
                      onClick={() =>
                        create.mutate(
                          { title: s.title, kind: s.kind, cadence: 'none', memoryId: s.memoryId },
                          { onError: (e) => toast(errorMessage(e), { tone: 'danger' }) },
                        )
                      }
                    >
                      Add as a thread
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => dismiss(s.memoryId)} icon={<X className="size-3.5" aria-hidden="true" />} aria-label={`Not now: ${s.title}`}>
                      <span className="sr-only">Not now</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {active.length === 0 && !adding ? (
            <p className="max-w-prose text-sm text-fg-muted">{voice.threadsEmpty}</p>
          ) : (
            <ul className="space-y-3">
              {active.map((i) => (
                <ThreadCard key={i.id} intention={i} today={today} teen={!!teen} />
              ))}
            </ul>
          )}

          {adding ? (
            <div className="mt-3">
              <AddForm onClose={() => setAdding(false)} />
            </div>
          ) : (
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => setAdding(true)} icon={<Plus className="size-4" aria-hidden="true" />}>
              Add a thread
            </Button>
          )}

          {resting.length > 0 && (
            <details className="mt-5">
              <summary className="cursor-pointer text-sm text-fg-muted hover:text-fg">Paused and finished ({resting.length})</summary>
              <ul className="mt-3 space-y-3">
                {resting.map((i) => (
                  <ThreadCard key={i.id} intention={i} today={today} teen={!!teen} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
