import { useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Mail, Plus } from 'lucide-react';
import { localDate } from '@solace/shared';
import { Button, toast } from '@/components/ui';
import { feedback } from '@/lib/feedback';
import { useProfile, useTimezone } from '@/lib/session';
import { STREAK_MILESTONES, useVoice } from '@/lib/voice';
import { errorMessage } from '@/lib/api';
import { Editor } from '../journal-core/editor/Editor';
import { EditorSkeleton } from '../journal-core/editor/EditorSkeleton';
import { hasContent, type EntrySync } from '../journal-core/editor/syncEngine';
import { useEngineSelector, useEntryEditor } from '../journal-core/editor/useEntryEditor';
import { restorable, useDraftSync, useRefreshUnsynced } from '../journal-core/editor/useDraftSync';
import { InlineError } from '../journal-core/EntryCard';
import { formatDay, localHour } from '../journal-core/format';
import { useDismissPrompt, useEntries, useStats, useTodayPrompt } from '../journal-core/queries';
import { TodayCompanion } from '../companion/TodayCompanion';
import { RememberWhen } from '../resurface/RememberWhen';
import { WeeklyReviewCard } from '../ritual/WeeklyReviewCard';
import { PromptCard } from './PromptCard';
import { RecentRail } from './RecentRail';
import { visibleStreak } from './streak';
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
  const voice = useVoice();

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

  // The day's first entry just reached the server: a small celebration (sound and haptics only if
  // the person turned them on). Later entries get the ordinary save cue.
  const todaysCount = todays.data?.pages[0]?.items.length ?? 0;
  const wasCreated = useRef(isCreated);
  useEffect(() => {
    if (isCreated && !wasCreated.current) feedback(todaysCount === 0 ? 'celebrate' : 'save');
    wasCreated.current = isCreated;
  }, [isCreated, todaysCount]);

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
  // Teen mode never shows streak counts.
  const streak = visibleStreak(profile?.mode, stats.data?.currentStreak);
  const wroteToday = (todays.data?.pages[0]?.items.length ?? 0) > 0 || isCreated;
  const reminderHour = profile?.reminderHour ?? null;
  const showNudge =
    reminderHour !== null && hour >= reminderHour && !wroteToday && todays.isSuccess && !hasText;
  const showPrompt = prompt.data && prompt.data.status === 'pending' && !promptSeeded;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-16 sm:px-8 sm:pt-10 lg:grid lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-14">
      <div className="min-w-0">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="type-heading text-3xl text-fg sm:text-4xl">
              {voice.greeting({ hour, name })}
            </h1>
            {(streak > 0 || showNudge) && (
              <p className="mt-1 text-sm text-fg-muted">
                {streak > 0 &&
                  (streak === 1
                    ? voice.streakStarted
                    : (STREAK_MILESTONES as readonly number[]).includes(streak)
                      ? voice.streakMilestone(streak)
                      : voice.streakDays(streak))}
                {showNudge && reminderHour !== null && (
                  <span className="text-accent">
                    {streak > 0 ? ' ' : ''}
                    {voice.reminderLine(formatHour(reminderHour))}
                  </span>
                )}
              </p>
            )}
            <Link
              to="/app/journal/capsules?new=1"
              className="-ml-2 mt-1 inline-flex min-h-11 items-center rounded-control px-2 text-sm text-fg-faint underline-offset-2 hover:text-fg hover:underline sm:min-h-8"
            >
              <Mail className="mr-1.5 size-4" aria-hidden="true" />
              {voice.capsuleLinkLabel}
            </Link>
          </div>
          <TodayCompanion syncStatus={status} />
        </header>

        <div className="mb-6 empty:hidden">
          <WeeklyReviewCard />
        </div>

        <div className="space-y-4">
          {restore && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-fg"
            >
              <span>
                You have an unsaved entry from {formatDay(restore.fields.entryDate, today)}
                {restore.fields.title.trim() ? ` (“${restore.fields.title.trim()}”)` : ''}.
              </span>
              <Link
                to={`/app/entries/${restore.id}`}
                className="inline-flex h-11 items-center rounded-control px-3 font-medium text-accent underline underline-offset-2 sm:h-8"
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
          <RememberWhen tz={tz} today={today} />
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
              placeholder={voice.todayPlaceholder}
              actions={
                hasText ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Plus className="size-4" aria-hidden="true" />}
                    onClick={() => startNew()}
                  >
                    New entry
                  </Button>
                ) : undefined
              }
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
