import { LIMITS, type AiStyle } from '@solace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AnimatePresence, m } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { RequireAuth } from '@/app/guards';
import { Wordmark } from '@/components/layout/Logo';
import { SkipLink } from '@/components/layout/SkipLink';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/fields';
import { WorldPicker } from '@/features/appearance/WorldPicker';
import { ThemeChoice } from '@/features/appearance/ThemeChoice';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { Motion, useWorldMotion } from '@/lib/motion';
import { ME_QUERY_KEY, browserTimezone, useProfile, useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useVoice } from '@/lib/voice';
import { useWorld } from '@/lib/world';
import { AiStylePicker, REMINDER_OPTIONS } from './choices';
import { TimezoneSelect } from './TimezoneSelect';

const STEPS = ['Your name', 'Your world', 'Your day', 'Solace’s voice'] as const;

/**
 * One step's heading, intro and fields. It slides in from the side you're heading towards (a
 * crossfade with reduced motion) and takes focus when it arrives, so screen readers hear the
 * new question.
 */
function StepBody({
  title,
  intro,
  focusOnMount,
  children,
}: {
  title: string;
  intro: string;
  focusOnMount: boolean;
  children: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus();
  }, [focusOnMount]);
  return (
    <>
      <h1
        ref={headingRef}
        tabIndex={-1}
        data-route-focus
        className="mt-8 type-title text-title leading-tight text-fg outline-none"
      >
        {title}
      </h1>
      <p className="mt-3 leading-relaxed text-fg-muted">{intro}</p>
      <div className="mt-8 flex flex-col gap-6">{children}</div>
    </>
  );
}

function Onboarding() {
  const { profile } = useProfile();
  const { email } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const voice = useVoice();
  const { world, setWorld } = useWorld();
  const { resolved } = useTheme();
  const { spring, reduced, fade } = useWorldMotion();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [moved, setMoved] = useState(false);
  const [name, setName] = useState(() => profile?.displayName || '');
  const [timezone, setTimezone] = useState(() =>
    profile && profile.timezone !== 'UTC' ? profile.timezone : browserTimezone(),
  );
  const [reminder, setReminder] = useState(() =>
    profile?.reminderHour == null ? '' : String(profile.reminderHour),
  );
  const [aiStyle, setAiStyle] = useState<AiStyle>(profile?.aiStyle ?? 'gentle');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'finish' | 'skip' | null>(null);

  if (profile?.onboardingDone) return <Navigate to="/app/today" replace />;

  const go = (next: number) => {
    setDirection(next > step ? 1 : -1);
    setMoved(true);
    setStep(next);
  };

  const save = async (mode: 'finish' | 'skip') => {
    setSaving(mode);
    setError(null);
    try {
      const trimmed = name.trim();
      const body = {
        onboardingDone: true,
        timezone,
        aiStyle,
        world,
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
    if (step < STEPS.length - 1) go(step + 1);
    else void save('finish');
  };

  const titles = [
    voice.onboardingNameTitle,
    voice.onboardingWorldTitle,
    voice.onboardingDayTitle,
    voice.onboardingVoiceTitle,
  ];
  const intros = [
    voice.onboardingNameIntro,
    voice.onboardingWorldIntro,
    voice.onboardingDayIntro,
    voice.onboardingVoiceIntro,
  ];
  const offset = reduced ? 0 : 28;

  return (
    <div className="relative isolate flex min-h-dvh flex-col bg-canvas">
      <SkipLink />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(50%_60%_at_50%_0%,var(--accent-soft),transparent_70%)]"
      />
      <header className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-5 sm:px-8">
        <Wordmark />
        <Button
          variant="ghost"
          size="sm"
          loading={saving === 'skip'}
          onClick={() => void save('skip')}
        >
          Skip for now
        </Button>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-xl flex-1 px-5 pt-8 pb-16 outline-none sm:pt-14"
      >
        <ol aria-label="Progress" className="flex items-center gap-2">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={clsx(
                  'h-1 rounded-full transition-all',
                  i === step ? 'w-8 bg-accent' : i < step ? 'w-4 bg-accent/60' : 'w-4 bg-line',
                )}
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

        <form onSubmit={onSubmit}>
          <Motion>
            <AnimatePresence mode="wait" initial={false} custom={direction}>
              <m.div
                key={step}
                custom={direction}
                variants={{
                  enter: (d: number) => ({ opacity: 0, x: d * offset }),
                  center: { opacity: 1, x: 0, transition: reduced ? fade : spring },
                  exit: (d: number) => ({
                    opacity: 0,
                    x: -d * offset,
                    transition: { duration: 0.12, ease: 'easeIn' },
                  }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
              >
                <StepBody title={titles[step]!} intro={intros[step]!} focusOnMount={moved}>
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
                      <fieldset>
                        <legend className="sr-only">World</legend>
                        <WorldPicker
                          value={world}
                          onChange={setWorld}
                          theme={resolved}
                          name="onboarding-world"
                        />
                      </fieldset>
                      <ThemeChoice />
                    </>
                  )}
                  {step === 2 && (
                    <>
                      <TimezoneSelect
                        value={timezone}
                        onChange={setTimezone}
                        hint="We filled this in from your device."
                      />
                      <Select
                        label="Daily reminder"
                        hint="If you haven’t written by this hour, Solace shows a gentle nudge inside the app. No emails, no push notifications."
                        options={REMINDER_OPTIONS}
                        value={reminder}
                        onChange={(e) => setReminder(e.target.value)}
                      />
                    </>
                  )}
                  {step === 3 && (
                    <fieldset>
                      <legend className="sr-only">Reflection voice</legend>
                      <AiStylePicker value={aiStyle} onChange={setAiStyle} />
                    </fieldset>
                  )}
                </StepBody>
              </m.div>
            </AnimatePresence>
          </Motion>

          {error && (
            <p
              role="alert"
              className="mt-6 rounded-control border border-danger/40 bg-danger-soft px-3.5 py-2.5 text-sm text-fg"
            >
              {error}
            </p>
          )}
          <div className="mt-8 flex items-center justify-between gap-3">
            {step > 0 ? (
              <Button variant="ghost" onClick={() => go(step - 1)}>
                Back
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" className="h-11 px-6 text-base" loading={saving === 'finish'}>
              {step < STEPS.length - 1 ? 'Continue' : voice.onboardingStart}
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
