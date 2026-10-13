import { LIMITS, type AiStyle } from '@solace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { RequireAuth } from '@/app/guards';
import { Wordmark } from '@/components/layout/Logo';
import { SkipLink } from '@/components/layout/SkipLink';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/fields';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { ME_QUERY_KEY, browserTimezone, useProfile, useSession } from '@/lib/session';
import { AiStylePicker, REMINDER_OPTIONS } from './choices';
import { TimezoneSelect } from './TimezoneSelect';

const STEPS = ['Your name', 'Your day', 'Solace’s voice'] as const;

function Onboarding() {
  const { profile } = useProfile();
  const { email } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(() => profile?.displayName || '');
  const [timezone, setTimezone] = useState(() =>
    profile && profile.timezone !== 'UTC' ? profile.timezone : browserTimezone(),
  );
  const [reminder, setReminder] = useState(() => (profile?.reminderHour == null ? '' : String(profile.reminderHour)));
  const [aiStyle, setAiStyle] = useState<AiStyle>(profile?.aiStyle ?? 'gentle');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'finish' | 'skip' | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  if (profile?.onboardingDone) return <Navigate to="/app/today" replace />;

  const save = async (mode: 'finish' | 'skip') => {
    setSaving(mode);
    setError(null);
    try {
      const trimmed = name.trim();
      const body = {
        onboardingDone: true,
        timezone,
        aiStyle,
        reminderHour: reminder === '' ? null : Number(reminder),
        ...(trimmed ? { displayName: trimmed.slice(0, LIMITS.displayNameMax) } : {}),
      };
      const next = await api.updateMe({ body });
      queryClient.setQueryData(ME_QUERY_KEY, next);
      navigate('/app/today', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setSaving(null);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (step < STEPS.length - 1) setStep(step + 1);
    else void save('finish');
  };

  const titles = ['What should Solace call you?', 'When does your day happen?', 'How should Solace talk with you?'];
  const intros = [
    'Just a first name is fine. It’s only used inside your journal.',
    'Your timezone decides which day an entry belongs to, so late-night writing lands on the right date.',
    'This sets the tone of Reflect answers and your weekly letter. You can change it any time in Settings.',
  ];

  return (
    <div className="relative isolate flex min-h-dvh flex-col bg-ink">
      <SkipLink />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(50%_60%_at_50%_0%,var(--lamp-soft),transparent_70%)]"
      />
      <header className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-5 sm:px-8">
        <Wordmark />
        <Button variant="ghost" size="sm" loading={saving === 'skip'} onClick={() => void save('skip')}>
          Skip for now
        </Button>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-xl flex-1 px-5 pt-8 pb-16 outline-none sm:pt-14">
        <ol aria-label="Progress" className="flex items-center gap-2">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={clsx('h-1 rounded-full transition-all', i === step ? 'w-8 bg-lamp' : i < step ? 'w-4 bg-lamp/60' : 'w-4 bg-line')}
              />
              <span className="sr-only">
                {label}
                {i === step ? ' (current step)' : i < step ? ' (done)' : ''}
              </span>
            </li>
          ))}
          <li aria-hidden="true" className="ml-2 text-xs text-fg-faint">
            Step {step + 1} of {STEPS.length}
          </li>
        </ol>

        <h1 ref={headingRef} tabIndex={-1} data-route-focus className="mt-8 font-serif text-[2.15rem] leading-tight font-[380] tracking-[-0.015em] text-fg outline-none">
          {titles[step]}
        </h1>
        <p className="mt-3 leading-relaxed text-fg-muted">{intros[step]}</p>

        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-6">
          {error && (
            <p role="alert" className="rounded-control border border-danger/40 bg-danger-soft px-3.5 py-2.5 text-sm text-fg">
              {error}
            </p>
          )}
          {step === 0 && (
            <Input
              label="Your name"
              autoComplete="given-name"
              autoFocus
              maxLength={LIMITS.displayNameMax}
              placeholder={email?.split('@')[0]}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          {step === 1 && (
            <>
              <TimezoneSelect value={timezone} onChange={setTimezone} hint="We filled this in from your device." />
              <Select
                label="Daily reminder"
                hint="If you haven’t written by this hour, Solace shows a gentle nudge inside the app. No emails, no push notifications."
                options={REMINDER_OPTIONS}
                value={reminder}
                onChange={(e) => setReminder(e.target.value)}
              />
            </>
          )}
          {step === 2 && (
            <fieldset>
              <legend className="sr-only">Reflection voice</legend>
              <AiStylePicker value={aiStyle} onChange={setAiStyle} />
            </fieldset>
          )}
          <div className="mt-2 flex items-center justify-between gap-3">
            {step > 0 ? (
              <Button variant="ghost" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" className="h-11 px-6 text-base" loading={saving === 'finish'}>
              {step < STEPS.length - 1 ? 'Continue' : 'Start writing'}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <RequireAuth requireOnboarded={false}>
      <Onboarding />
    </RequireAuth>
  );
}
