import { useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Plus } from 'lucide-react';
import { localDate } from '@solace/shared';
import { Button, toast } from '@/components/ui';
import { useProfile, useTimezone } from '@/lib/session';
import { errorMessage } from '@/lib/api';
import { Editor } from '../journal-core/editor/Editor';
import { EditorSkeleton } from '../journal-core/editor/EditorSkeleton';
import { hasContent, type EntrySync } from '../journal-core/editor/syncEngine';
import { useEngineSelector, useEntryEditor } from '../journal-core/editor/useEntryEditor';
import { restorable, useDraftSync, useRefreshUnsynced } from '../journal-core/editor/useDraftSync';
import { InlineError } from '../journal-core/EntryCard';
import { formatDay, greeting, localHour, plural } from '../journal-core/format';
import { useDismissPrompt, useEntries, useStats, useTodayPrompt } from '../journal-core/queries';
import { PromptCard } from './PromptCard';
import { RecentRail } from './RecentRail';
import { useTodayEntry } from './useTodayEntry';

function formatHour(h: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, h)));
}

function applySeed(engine: EntrySync, text: string, promptId: string) {
  if (hasContent(engine.getSnapshot().fields)) return;
  engine.setPromptId(promptId);
  engine.edit({ body: `> ${text}

` });
}

export default function TodayPage() {
  const tz = useTimezone();
  const { profile } = useProfile();
  const today = localDate(new Date(), tz);
  const hour = localHour(tz);
  const [params, setParams] = useSearchParams();

  const { current, startNew } = useTodayEntry(today);
  // A prompt waiting for a freshly started entry's engine to come up.
  const seedRef = useRef<{ id: string; text: string; promptId: string } | null>(null);

  const stats = useStats(tz);
  const prompt = useTodayPrompt(tz);
  const dismiss = useDismissPrompt(tz);
  const todays = useEntries({ from: today, to: today }, { limit: 1 });
  const { unsynced } = useDraftSync();

  const editor = useEntryEditor(current?.id ?? '', {
    fetchServer: !!current && !current.isNew,
    allowMissing: true,
    entryDate: today,
    promptId: current?.promptId,
  });
  const ready = current && editor.load.state === 'ready' ? editor.load.engine : null;
  // Primitive subscriptions only: typing doesn't re-render this page.
  const live = editor.engine;
  const status = useEngineSelector(live, (s) => s.status);
  const isCreated = useEngineSelector(live, (s) => s.version !== null) === true;
  const hasText = useEngineSelector(live, (s) => hasContent(s.fields)) === true;
  const promptSeeded = useEngineSelector(live, (s) => (prompt.data ? s.fields.body.startsWith(`> ${prompt.data.text}`) : false)) === true;
  useRefreshUnsynced(status);

  // "New entry" from the command palette / nav: /app/today?new=1
  const handledNew = useRef(false);
  useEffect(() => {
    if (params.get('new') !== '1' || !ready || handledNew.current) return;
    handledNew.current = true;
    if (hasContent(ready.getSnapshot().fields)) startNew();
    setParams((p) => {
      p.delete('new');
      return p;
    }, { replace: true });
  }, [params, ready, startNew, setParams]);

  // Seed a prompt into the (empty) editor once its engine is live.
  useEffect(() => {
    const seed = seedRef.current;
    if (!seed || !ready || ready.id !== seed.id) return;
    seedRef.current = null;
    applySeed(ready, seed.text, seed.promptId);
  }, [ready]);

  const writeAboutPrompt = () => {
    const p = prompt.data;
    if (!p || !ready || !current) return;
    if (hasContent(ready.getSnapshot().fields)) {
      // Never mix a prompt into words already written: start a fresh entry for it.
      const id = startNew(p.id);
      if (id) seedRef.current = { id, text: p.text, promptId: p.id };
    } else {
      applySeed(ready, p.text, p.id);
    }
  };

  const restore = useMemo(() => restorable(unsynced, current?.id)[0], [unsynced, current?.id]);
  const name = profile?.displayName?.trim().split(/\s+/)[0];
  const streak = stats.data?.currentStreak ?? 0;
  const wroteToday = (todays.data?.pages[0]?.items.length ?? 0) > 0 || isCreated;
  const reminderHour = profile?.reminderHour ?? null;
  const showNudge =
    reminderHour !== null && hour >= reminderHour && !wroteToday && todays.isSuccess && !hasText;
  const showPrompt = prompt.data && prompt.data.status === 'pending' && !promptSeeded;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-16 sm:px-8 sm:pt-10 lg:grid lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-14">
      <div className="min-w-0">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h1 className="font-serif text-3xl text-fg sm:text-4xl">
              {greeting(hour)}
              {name ? `, ${name}` : ''}
            </h1>
            {(streak > 0 || showNudge) && (
              <p className="mt-1 text-sm text-fg-muted">
                {streak > 0 && (streak === 1 ? 'You’ve started a streak.' : `${plural(streak, 'day')} in a row.`)}
                {showNudge && reminderHour !== null && (
                  <span className="text-lamp">
                    {streak > 0 ? ' ' : ''}You planned to write around {formatHour(reminderHour)}. A few lines is enough.
                  </span>
                )}
              </p>
            )}
          </div>
          {ready && hasText && (
            <Button variant="ghost" size="sm" icon={<Plus className="size-4" aria-hidden="true" />} onClick={() => startNew()} className="max-sm:h-11">
              New entry
            </Button>
          )}
        </header>

        <div className="space-y-4">
          {restore && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-lamp/30 bg-lamp-soft px-4 py-3 text-sm text-fg"
            >
              <span>
                You have an unsaved entry from {formatDay(restore.fields.entryDate, today)}
                {restore.fields.title.trim() ? ` (“${restore.fields.title.trim()}”)` : ''}.
              </span>
              <Link
                to={`/app/entries/${restore.id}`}
                className="inline-flex h-11 items-center rounded-control px-3 font-medium text-lamp underline underline-offset-2 sm:h-8"
              >
                Restore
              </Link>
            </div>
          )}
          {showPrompt && prompt.data && (
            <PromptCard
              prompt={prompt.data}
              onWrite={writeAboutPrompt}
              onDismiss={() =>
                dismiss.mutate(prompt.data!.id, {
                  onError: (err) => toast(errorMessage(err), { tone: 'danger' }),
                })
              }
            />
          )}
        </div>

        <div className="mt-8">
          {editor.load.state === 'error' ? (
            <InlineError message={errorMessage(editor.load.error)} onRetry={editor.load.retry} />
          ) : ready ? (
            <Editor
              key={ready.id}
              engine={ready}
              server={editor.server}
              dateMode="label"
              today={today}
              autoFocus={false}
              placeholder="Write anything. It saves as you go."
            />
          ) : (
            <EditorSkeleton />
          )}
        </div>
      </div>

      <aside className="mt-14 lg:mt-[4.5rem]" aria-label="Recent entries">
        <RecentRail today={today} excludeId={isCreated ? current?.id : undefined} />
      </aside>
    </div>
  );
}
