import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Check } from 'lucide-react';
import type { Entry, Intention } from '@solace/shared';
import { Button, Select, Textarea, buttonClasses, toast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { play } from '@/lib/feedback';
import { useSession, useTimezone } from '@/lib/session';
import { useVoice } from '@/lib/voice';
import { useWeeklyRitual } from '../journal-core/queries-v3';
import {
  EMPTY_DRAFT,
  STEP_COUNT,
  buildInput,
  clearDraft,
  currentWeek,
  hasAnswer,
  loadDraft,
  markDone,
  saveDraft,
  type Cadence,
  type RitualDraft,
} from './ritualLogic';

const CADENCES = [
  { value: 'none', label: 'No schedule' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
];

export default function RitualPage() {
  const { userId } = useSession();
  const tz = useTimezone();
  const voice = useVoice();
  const ritual = useWeeklyRitual();
  const [draft, setDraft] = useState<RitualDraft>(() => (userId ? loadDraft(userId) : EMPTY_DRAFT));
  const [done, setDone] = useState<{ entry: Entry; intention: Intention | null } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const loadedFor = useRef(userId);

  // The session may arrive after first render: pick up the stored draft once.
  useEffect(() => {
    if (userId && loadedFor.current !== userId) {
      loadedFor.current = userId;
      setDraft(loadDraft(userId));
    }
  }, [userId]);

  const update = (patch: Partial<RitualDraft>) =>
    setDraft((d) => {
      const next = { ...d, ...patch };
      if (userId) saveDraft(userId, next);
      return next;
    });

  // Move focus to the step heading when the step changes, so keyboard and screen-reader users land on it.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [draft.step]);

  const last = draft.step === STEP_COUNT - 1;
  const input = buildInput(draft, tz);

  const submit = () => {
    if (!input) return;
    ritual.mutate(input, {
      onSuccess: (res) => {
        if (userId) {
          clearDraft(userId);
          markDone(userId, currentWeek(new Date(), tz));
        }
        play('celebrate');
        setDone(res);
        setDraft(EMPTY_DRAFT);
      },
      onError: (err) => toast(errorMessage(err), { tone: 'danger' }),
    });
  };

  if (done) {
    return (
      <Shell>
        <div role="status" className="rounded-card border border-line bg-surface px-5 py-6 sm:px-7">
          <h2 className="type-heading text-2xl text-fg">{voice.ritualDoneTitle}</h2>
          <p className="mt-2 text-fg-muted">{voice.ritualDoneBody}</p>
          {done.intention && (
            <p className="mt-5 text-sm text-fg-muted">
              Your intention for next week
              <span className="mt-1 block type-heading text-lg text-fg">{done.intention.title}</span>
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to={`/app/entries/${done.entry.id}`} className={buttonClasses('primary')}>
              Read your entry
            </Link>
            <Link to="/app/today" className={buttonClasses('ghost')}>
              Back to Today
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  const steps = [
    {
      title: voice.ritualHighsTitle,
      hint: 'Big or small. A good conversation counts.',
      field: (
        <Textarea
          label="Highs"
          rows={6}
          value={draft.highs}
          maxLength={2000}
          className="font-prose"
          onChange={(e) => update({ highs: e.target.value })}
        />
      ),
    },
    {
      title: voice.ritualLowsTitle,
      hint: 'Only what you want to put down. You can skip this.',
      field: (
        <Textarea
          label="Lows"
          rows={6}
          value={draft.lows}
          maxLength={2000}
          className="font-prose"
          onChange={(e) => update({ lows: e.target.value })}
        />
      ),
    },
    {
      title: voice.ritualIntentionTitle,
      hint: 'Keep it small enough to start on Monday.',
      field: (
        <div className="space-y-4">
          <Textarea
            label="Intention"
            rows={2}
            value={draft.intention}
            maxLength={120}
            onChange={(e) => update({ intention: e.target.value })}
          />
          <Select
            label="How often? (optional)"
            options={CADENCES}
            value={draft.cadence}
            onChange={(e) => update({ cadence: e.target.value as Cadence })}
          />
        </div>
      ),
    },
  ];
  const step = steps[draft.step]!;

  return (
    <Shell>
      <p className="text-sm text-fg-muted">{voice.ritualIntro}</p>
      <section aria-labelledby="ritual-step" className="mt-6 rounded-card border border-line bg-surface px-5 py-6 sm:px-7">
        <p className="text-xs text-fg-faint" aria-live="polite">
          Step {draft.step + 1} of {STEP_COUNT}
        </p>
        <h2 id="ritual-step" ref={headingRef} tabIndex={-1} className="mt-2 type-heading text-xl text-fg outline-none sm:text-2xl">
          {step.title}
        </h2>
        <p className="mt-1 mb-4 text-sm text-fg-muted">{step.hint}</p>
        {step.field}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            {draft.step > 0 && (
              <Button variant="ghost" icon={<ArrowLeft className="size-4" aria-hidden="true" />} onClick={() => update({ step: draft.step - 1 })}>
                Back
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!last && (
              <Button variant="ghost" onClick={() => update({ step: draft.step + 1 })}>
                Skip
              </Button>
            )}
            {last ? (
              <Button
                icon={<Check className="size-4" aria-hidden="true" />}
                loading={ritual.isPending}
                disabled={!hasAnswer(draft)}
                onClick={submit}
              >
                Save my week
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => update({ step: draft.step + 1 })}>
                Next
              </Button>
            )}
          </div>
        </div>
        {last && !hasAnswer(draft) && (
          <p className="mt-3 text-sm text-fg-muted">Answer at least one question to save your week.</p>
        )}
      </section>
      <p className="mt-4 text-xs text-fg-faint">Your answers stay on this device until you save.</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-6 pb-16 sm:px-8 sm:pt-10">
      <h1 className="type-heading mb-2 text-3xl text-fg sm:text-4xl">Weekly review</h1>
      {children}
    </div>
  );
}
