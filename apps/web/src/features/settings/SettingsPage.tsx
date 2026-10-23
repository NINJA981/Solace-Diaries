import { LIMITS, type AiStyle, type Profile, type UpdateProfileInput } from '@solace/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Download, KeyRound, LogOut } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Input, Select } from '@/components/ui/fields';
import { toast } from '@/components/ui/toast';
import { AiStylePicker, AI_STYLES, REMINDER_OPTIONS } from '@/features/onboarding/choices';
import { TimezoneSelect } from '@/features/onboarding/TimezoneSelect';
import { PasswordInput } from '@/features/auth/AuthLayout';
import { api } from '@/lib/api';
import { MIN_PASSWORD, authErrorMessage, authRedirect } from '@/lib/auth-errors';
import { getGeminiKey, isPlausibleGeminiKey, maskKey, setGeminiKey } from '@/lib/byok';
import { errorMessage } from '@/lib/errors';
import { ME_QUERY_KEY, useProfile, useSession } from '@/lib/session';
import { getSupabase } from '@/lib/supabase-lazy';
import { useTheme } from '@/lib/theme';
import { buzz, getFeedbackPrefs, play, setFeedbackPrefs } from '@/lib/feedback';
import { voiceNow } from '@/lib/voice';
import { useWorld } from '@/lib/world';
import { SwitchRow } from '@/features/appearance/SwitchRow';
import { ThemeChoice } from '@/features/appearance/ThemeChoice';
import { WorldPicker } from '@/features/appearance/WorldPicker';

type AuthErr = Parameters<typeof authErrorMessage>[0];

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'voice', label: 'Reflection voice' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'gemini', label: 'Gemini key' },
  { id: 'data', label: 'Your data' },
  { id: 'account', label: 'Account' },
  { id: 'danger', label: 'Delete account' },
];

function Section({
  id,
  title,
  description,
  children,
  tone,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  tone?: 'danger';
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-line py-10 first:border-t-0 first:pt-0">
      <h2 id={`${id}-title`} className={clsx('type-heading text-section leading-tight', tone === 'danger' ? 'text-danger' : 'text-fg')}>
        {title}
      </h2>
      {description && <div className="mt-2 max-w-prose leading-relaxed text-fg-muted">{description}</div>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileInput) => api.updateMe({ body }),
    onSuccess: (next) => queryClient.setQueryData(ME_QUERY_KEY, next),
  });
}

function ProfileSection({ profile }: { profile: Profile }) {
  const update = useUpdateProfile();
  const [name, setName] = useState(profile.displayName);
  const [timezone, setTimezone] = useState(profile.timezone);
  const [reminder, setReminder] = useState(profile.reminderHour == null ? '' : String(profile.reminderHour));
  const [nameError, setNameError] = useState<string>();

  const dirty =
    name.trim() !== profile.displayName ||
    timezone !== profile.timezone ||
    reminder !== (profile.reminderHour == null ? '' : String(profile.reminderHour));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError('Enter a name, even just an initial.');
      return;
    }
    setNameError(undefined);
    update.mutate(
      { displayName: name.trim(), timezone, reminderHour: reminder === '' ? null : Number(reminder) },
      {
        onSuccess: () => toast(voiceNow().profileSaved, { tone: 'success' }),
        onError: (err) => toast(errorMessage(err), { tone: 'danger' }),
      },
    );
  };

  return (
    <Section id="profile" title="Profile" description="How Solace addresses you, and which day your entries belong to.">
      <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-5">
        <Input label="Name" value={name} maxLength={LIMITS.displayNameMax} error={nameError} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
        <TimezoneSelect value={timezone} onChange={setTimezone} hint="Entries written after midnight count toward the new day in this timezone." />
        <Select
          label="Daily reminder"
          hint="A gentle nudge inside the app if you haven’t written by this hour. No emails or push notifications."
          options={REMINDER_OPTIONS}
          value={reminder}
          onChange={(e) => setReminder(e.target.value)}
        />
        <div>
          <Button type="submit" loading={update.isPending} disabled={!dirty}>
            Save changes
          </Button>
        </div>
      </form>
    </Section>
  );
}

function VoiceSection({ profile }: { profile: Profile }) {
  const update = useUpdateProfile();
  // Optimistic: show the pending choice while saving, otherwise the saved one.
  const value: AiStyle = (update.isPending && update.variables?.aiStyle) || profile.aiStyle;

  const choose = (next: AiStyle) => {
    update.mutate(
      { aiStyle: next },
      {
        onSuccess: () => toast(`Reflection voice set to ${AI_STYLES.find((s) => s.value === next)?.label.toLowerCase()}.`, { id: 'voice' }),
        onError: (err) => toast(errorMessage(err), { tone: 'danger' }),
      },
    );
  };

  return (
    <Section id="voice" title="Reflection voice" description="The tone of Reflect answers and your weekly letter. What Solace says stays grounded in your entries either way.">
      <fieldset className="max-w-2xl">
        <legend className="sr-only">Reflection voice</legend>
        <AiStylePicker value={value} onChange={choose} name="settings-ai-style" />
      </fieldset>
    </Section>
  );
}

function AppearanceSection({ profile }: { profile: Profile }) {
  const { world, manifest, setWorld } = useWorld();
  const { resolved } = useTheme();
  const update = useUpdateProfile();
  const [companion, setCompanion] = useState(profile.companionName ?? '');
  // Optimistic: show the pending choice while it saves, otherwise the saved one.
  const pending = update.isPending ? update.variables : undefined;
  const sound = pending?.soundEnabled ?? profile.soundEnabled ?? false;
  const haptics = pending?.hapticsEnabled ?? profile.hapticsEnabled ?? false;

  const toggle = (key: 'soundEnabled' | 'hapticsEnabled', next: boolean) => {
    if (next) {
      // Switch it on here and now (this click is the gesture audio needs) and let them hear it.
      const prefs = getFeedbackPrefs();
      setFeedbackPrefs(key === 'soundEnabled' ? { ...prefs, sound: true } : { ...prefs, haptics: true });
      if (key === 'soundEnabled') play('tap');
      else buzz('tap');
    }
    update.mutate({ [key]: next }, { onError: (err) => toast(errorMessage(err), { tone: 'danger' }) });
  };

  const saveCompanion = (e: FormEvent) => {
    e.preventDefault();
    update.mutate(
      { companionName: companion.trim() },
      {
        onSuccess: () => toast('Companion name saved.', { tone: 'success', id: 'companion' }),
        onError: (err) => toast(errorMessage(err), { tone: 'danger' }),
      },
    );
  };

  return (
    <Section
      id="appearance"
      title="Appearance"
      description="Your world comes with you to every device you sign in on. Light or dark is saved on this device."
    >
      <div className="flex flex-col gap-10">
        <fieldset>
          <legend className="mb-3 text-sm font-medium text-fg">World</legend>
          <WorldPicker value={world} onChange={setWorld} theme={resolved} name="settings-world" className="max-w-3xl" />
        </fieldset>
        <ThemeChoice name="settings-theme" />
        <fieldset className="flex flex-col gap-5">
          <legend className="mb-3 text-sm font-medium text-fg">Sound and touch</legend>
          <SwitchRow
            label="Sounds"
            hint="Soft sounds in your world’s style when you save and when something needs you."
            checked={sound}
            onChange={(next) => toggle('soundEnabled', next)}
          />
          <SwitchRow
            label="Vibration"
            hint="A light buzz on phones that support it. It stays off while your device asks for reduced motion."
            checked={haptics}
            onChange={(next) => toggle('hapticsEnabled', next)}
          />
        </fieldset>
        <form onSubmit={saveCompanion} className="flex max-w-md flex-col gap-3">
          <Input
            label="Companion’s name"
            hint={`The small companion that keeps you company in your world. Leave it empty to call it ${manifest.companionName}.`}
            value={companion}
            maxLength={24}
            placeholder={manifest.companionName}
            autoComplete="off"
            onChange={(e) => setCompanion(e.target.value)}
          />
          <div>
            <Button type="submit" variant="secondary" disabled={companion.trim() === (profile.companionName ?? '')}>
              Save name
            </Button>
          </div>
        </form>
      </div>
    </Section>
  );
}

function GeminiSection() {
  const [stored, setStored] = useState<string | null>(() => getGeminiKey());
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();

  const save = (e: FormEvent) => {
    e.preventDefault();
    const key = draft.trim();
    if (!isPlausibleGeminiKey(key)) {
      setError('That doesn’t look like a Gemini API key. Keys start with “AIza” and are 39 characters long.');
      return;
    }
    setGeminiKey(key);
    setStored(key);
    setDraft('');
    setError(undefined);
    toast('Gemini key saved on this device.', { tone: 'success' });
  };

  const remove = () => {
    setGeminiKey(null);
    setStored(null);
    toast('Gemini key removed from this device.');
  };

  return (
    <Section
      id="gemini"
      title="Your Gemini key"
      description={
        <>
          <p>
            Optional. Solace’s AI uses our Gemini key by default, with a daily limit. If you’d like your own limit, add a
            key from Google AI Studio.
          </p>
          <p className="mt-2">
            The key is stored only in this browser and sent with your requests. It never reaches our database or logs,
            so you’ll need to add it again on other devices.
          </p>
        </>
      }
    >
      {stored ? (
        <div className="flex max-w-md flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
          <span className="flex items-center gap-3 text-sm text-fg">
            <KeyRound aria-hidden="true" className="size-4 text-accent" />
            <span>
              Using your key <span className="text-fg-muted">{maskKey(stored)}</span>
            </span>
          </span>
          <Button variant="ghost" size="sm" onClick={remove}>
            Remove key
          </Button>
        </div>
      ) : (
        <form onSubmit={save} className="flex max-w-md flex-col gap-3" noValidate>
          <Input
            label="Gemini API key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="AIza…"
            value={draft}
            error={error}
            hint="We only check the format here. If the key is wrong, AI features will say so when you next use them."
            onChange={(e) => setDraft(e.target.value)}
          />
          <div>
            <Button type="submit" variant="secondary" disabled={!draft.trim()}>
              Save key on this device
            </Button>
          </div>
        </form>
      )}
      <p className="mt-3 max-w-md text-xs leading-snug text-fg-muted">
        With your own key, Google’s terms for that key apply. Free-tier keys may allow Google to use your requests to
        improve its products.
      </p>
    </Section>
  );
}

function DataSection() {
  const [pending, setPending] = useState<'markdown' | 'json' | null>(null);
  const run = async (format: 'markdown' | 'json') => {
    setPending(format);
    try {
      const { filename } = await api.exportMe({ query: { format } });
      toast(`Downloaded ${filename}.`, { tone: 'success' });
    } catch (err) {
      toast(errorMessage(err), { tone: 'danger' });
    } finally {
      setPending(null);
    }
  };
  return (
    <Section
      id="data"
      title="Your data"
      description="Download everything you’ve written, with dates, moods, tags and the memories Solace keeps. Photos aren’t included in exports yet."
    >
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" icon={<Download aria-hidden="true" className="size-4" />} loading={pending === 'markdown'} onClick={() => void run('markdown')}>
          Export as Markdown
        </Button>
        <Button variant="secondary" icon={<Download aria-hidden="true" className="size-4" />} loading={pending === 'json'} onClick={() => void run('json')}>
          Export as JSON
        </Button>
      </div>
    </Section>
  );
}

function AccountSection() {
  const { email, signOut } = useSession();
  const [newEmail, setNewEmail] = useState('');
  const [emailPending, setEmailPending] = useState(false);
  const [emailError, setEmailError] = useState<string>();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwPending, setPwPending] = useState(false);
  const [pwError, setPwError] = useState<string>();
  const [confirmOut, setConfirmOut] = useState(false);

  const changeEmail = async (e: FormEvent) => {
    e.preventDefault();
    setEmailError(undefined);
    const address = newEmail.trim();
    if (!address || address === email) {
      setEmailError('Enter the new address you’d like to use.');
      return;
    }
    setEmailPending(true);
    try {
      const supabase = await getSupabase();
      const { error } = await supabase.auth.updateUser({ email: address }, { emailRedirectTo: authRedirect('/app/settings') });
      if (error) throw error;
      setNewEmail('');
      toast(`Check ${address} (and your current inbox) for a confirmation link.`, { tone: 'success', duration: 9000 });
    } catch (err) {
      setEmailError(authErrorMessage(err as AuthErr));
    } finally {
      setEmailPending(false);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError(undefined);
    if (password.length < MIN_PASSWORD) return setPwError(`Your password needs at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setPwError('The two passwords don’t match. Type them again.');
    setPwPending(true);
    try {
      const supabase = await getSupabase();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword('');
      setConfirm('');
      toast('Password updated.', { tone: 'success' });
    } catch (err) {
      setPwError(authErrorMessage(err as AuthErr));
    } finally {
      setPwPending(false);
    }
  };

  return (
    <Section id="account" title="Account">
      <div className="flex max-w-md flex-col gap-10">
        <form onSubmit={(e) => void changeEmail(e)} className="flex flex-col gap-3" noValidate>
          <h3 className="font-medium text-fg">Email address</h3>
          <p className="-mt-1 text-sm text-fg-muted">
            You sign in with <span className="text-fg">{email}</span>.
          </p>
          <Input label="New email address" type="email" autoComplete="email" value={newEmail} error={emailError} onChange={(e) => setNewEmail(e.target.value)} />
          <div>
            <Button type="submit" variant="secondary" loading={emailPending} disabled={!newEmail.trim()}>
              Change email
            </Button>
          </div>
        </form>

        <form onSubmit={(e) => void changePassword(e)} className="flex flex-col gap-3" noValidate>
          <h3 className="font-medium text-fg">Password</h3>
          {pwError && (
            <p role="alert" className="text-sm text-danger">
              {pwError}
            </p>
          )}
          <PasswordInput label="New password" autoComplete="new-password" showStrength value={password} onChange={(e) => setPassword(e.target.value)} />
          <PasswordInput label="Confirm new password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <div>
            <Button type="submit" variant="secondary" loading={pwPending} disabled={!password || !confirm}>
              Update password
            </Button>
          </div>
        </form>

        <div className="flex flex-col gap-3">
          <h3 className="font-medium text-fg">Devices</h3>
          <p className="-mt-1 text-sm text-fg-muted">Signed in somewhere you no longer use? Sign out of Solace on every device, including this one.</p>
          <div>
            <Button variant="secondary" icon={<LogOut aria-hidden="true" className="size-4" />} onClick={() => setConfirmOut(true)}>
              Sign out everywhere
            </Button>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmOut}
        onOpenChange={setConfirmOut}
        title="Sign out on every device?"
        description="You’ll need to sign in again on each phone, tablet and computer, including this one. Your journal isn’t affected."
        confirmLabel="Sign out everywhere"
        cancelLabel="Stay signed in"
        onConfirm={async () => {
          // The route guard then sends this device to the sign-in page.
          await signOut({ scope: 'global' });
        }}
      />
    </Section>
  );
}

function DangerSection() {
  const { email, signOut } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const matches = !!email && typed.trim().toLowerCase() === email.toLowerCase();

  return (
    <Section
      id="danger"
      tone="danger"
      title="Delete account"
      description="Permanently delete your account, every entry and photo, and everything Solace remembers about you. Export first if you’d like to keep a copy."
    >
      <Button
        variant="danger"
        onClick={() => {
          setTyped('');
          setOpen(true);
        }}
      >
        Delete account
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="danger"
        title="Delete your account and journal?"
        description="This erases your entries, photos, conversations and memories right away. It can’t be undone."
        confirmLabel="Delete everything"
        cancelLabel="Keep my account"
        confirmDisabled={!matches}
        onConfirm={async () => {
          if (!email) return;
          await api.deleteMe({ body: { confirmEmail: email } });
          // Leave the guarded area first so the sign-out doesn't bounce through /login.
          navigate('/', { replace: true });
          // 'deleted' also clears the BYOK key and this account's drafts/queue from this browser.
          await signOut({ scope: 'local', reason: 'deleted' }).catch(() => {});
          toast(voiceNow().accountDeleted, { duration: 9000 });
        }}
      >
        <Input
          label={`Type ${email ?? 'your email'} to confirm`}
          type="email"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </ConfirmDialog>
    </Section>
  );
}

export default function SettingsPage() {
  const { profile } = useProfile();
  if (!profile) return null;
  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 md:py-12">
      <h1 className="type-title text-4xl leading-tight text-fg">Settings</h1>
      <div className="mt-10 grid gap-10 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-14">
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="sticky top-8 flex flex-col gap-1 text-sm">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className={clsx(
                    'block rounded-control px-3 py-1.5 transition-colors hover:bg-sunken hover:text-fg',
                    s.id === 'danger' ? 'text-danger' : 'text-fg-muted',
                  )}
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          <ProfileSection profile={profile} />
          <VoiceSection profile={profile} />
          <AppearanceSection profile={profile} />
          <GeminiSection />
          <DataSection />
          <AccountSection />
          <DangerSection />
        </div>
      </div>
    </div>
  );
}
