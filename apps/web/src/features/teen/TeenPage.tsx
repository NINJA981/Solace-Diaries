import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate } from 'react-router';
import { RequireAuth } from '@/app/guards';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/fields';
import { AuthLayout, FormError } from '@/features/auth/AuthLayout';
import { api } from '@/lib/api';
import { errorMessage, isApiError } from '@/lib/errors';
import { ME_QUERY_KEY, useSession } from '@/lib/session';
import { AccountExit } from './AccountExit';
import { CrisisResources } from './CrisisResources';
import { gateTarget } from './age';
import { clearConsentRequest, readConsentRequest, resendWaitSeconds, saveConsentRequest, type ConsentRequestRecord } from './consent-request';

export const POLL_MS = 15_000;

function AskForm({
  initialEmail,
  onSent,
  intro,
}: {
  initialEmail?: string;
  onSent: (record: ConsentRequestRecord, email: string) => void;
  intro: string;
}) {
  const [email, setEmail] = useState(initialEmail ?? '');
  const [error, setError] = useState<string>();
  const [form, setForm] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address.includes('@')) {
      setError('Enter a full email address, like name@example.com.');
      return;
    }
    setSaving(true);
    setError(undefined);
    setForm(null);
    try {
      const res = await api.requestConsent({ body: { parentEmail: address } });
      onSent({ sentTo: res.sentTo, expiresAt: res.expiresAt, sentAt: Date.now() }, address);
    } catch (err) {
      if (isApiError(err) && err.fields?.parentEmail) setError(err.fields.parentEmail);
      else setForm(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5" noValidate>
      <p className="leading-relaxed text-fg-muted">{intro}</p>
      <FormError>{form}</FormError>
      <Input
        label="Parent or guardian’s email"
        type="email"
        autoComplete="off"
        inputMode="email"
        spellCheck={false}
        value={email}
        error={error}
        hint="They get one email with a link to read about Solace and choose yes or no. We keep only a scrambled fingerprint of their address, not the address itself."
        onChange={(e) => setEmail(e.target.value)}
      />
      <div>
        <Button type="submit" className="h-11 px-6 text-base" loading={saving}>
          Send the email
        </Button>
      </div>
    </form>
  );
}

function Waiting({
  record,
  email,
  onChange,
  onResent,
}: {
  record: ConsentRequestRecord;
  email?: string;
  onChange: () => void;
  onResent: (record: ConsentRequestRecord) => void;
}) {
  const [wait, setWait] = useState(() => resendWaitSeconds(record.sentAt));
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(resendWaitSeconds(record.sentAt)), 1000);
    return () => clearTimeout(t);
  }, [wait, record.sentAt]);

  const resend = async () => {
    if (!email) return onChange(); // we never keep the address: ask for it again
    setResending(true);
    setError(undefined);
    try {
      const res = await api.requestConsent({ body: { parentEmail: email } });
      const next = { sentTo: res.sentTo, expiresAt: res.expiresAt, sentAt: Date.now() };
      saveConsentRequest(next);
      onResent(next);
      setWait(resendWaitSeconds(next.sentAt));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setResending(false);
    }
  };

  const until = new Date(record.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  return (
    <div className="flex flex-col gap-6">
      <div role="status" className="rounded-card border border-line bg-surface p-5">
        <p className="leading-relaxed text-fg">
          We emailed <span className="font-medium break-all">{record.sentTo}</span>. The link works until {until}.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          This page checks for their answer every few seconds, so you can leave it open. When they say yes, Solace
          opens by itself.
        </p>
      </div>
      <FormError>{error}</FormError>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" loading={resending} disabled={wait > 0} onClick={() => void resend()}>
          {wait > 0 ? `Send it again in ${wait}s` : 'Send it again'}
        </Button>
        <Button variant="ghost" onClick={onChange}>
          Use a different email
        </Button>
      </div>
      <p className="text-sm leading-relaxed text-fg-muted">
        It can take a few minutes, and sometimes lands in spam. You could also tell your parent it’s coming.
      </p>
    </div>
  );
}

function Locked({ onAskAgain }: { onAskAgain: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <p className="leading-relaxed text-fg-muted">
        A parent or guardian either said no or took their approval back, so your journal is locked for now. Nothing has
        been deleted. Your entries are still yours: you can download them, or delete your account if you’d rather.
      </p>
      <AccountExit />
      <div>
        <Button variant="secondary" onClick={onAskAgain}>
          Ask a parent again
        </Button>
      </div>
    </div>
  );
}

function Teen() {
  const { signOut, userId } = useSession();
  const queryClient = useQueryClient();
  // Same cache entry as useProfile, but refreshed every 15 seconds while we wait for a parent.
  const { data: profile } = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: ({ signal }) => api.getMe({ signal }),
    staleTime: 0,
    refetchInterval: POLL_MS,
  });
  const [record, setRecord] = useState<ConsentRequestRecord | null>(() => readConsentRequest(userId));
  const [email, setEmail] = useState<string>();
  const [asking, setAsking] = useState(false);
  const done = !!profile && (profile.mode !== 'teen' || profile.consentStatus === 'granted');

  useEffect(() => {
    if (done) clearConsentRequest(userId);
  }, [done, userId]);

  if (!profile) return null;
  if (done) {
    return <Navigate to={gateTarget(profile) ?? '/app/today'} replace />;
  }

  const locked = profile.consentStatus === 'revoked' && !asking;
  const sent = (r: ConsentRequestRecord, address: string) => {
    saveConsentRequest(r, userId);
    setRecord(r);
    setEmail(address);
    setAsking(false);
    void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
  };

  let title: string;
  let body: ReactNode;
  if (locked) {
    title = 'Your journal is on hold';
    body = <Locked onAskAgain={() => setAsking(true)} />;
  } else if (record && !asking) {
    title = 'Waiting for your parent';
    body = (
      <Waiting
        record={record}
        email={email}
        onChange={() => {
          clearConsentRequest(userId);
          setRecord(null);
          setAsking(true);
        }}
        onResent={setRecord}
      />
    );
  } else {
    title = 'Ask a parent or guardian';
    body = (
      <AskForm
        initialEmail={email}
        onSent={sent}
        intro="Because you’re under 18, a parent or guardian needs to say yes before you can use Solace. Give us their email and we’ll send them a short explanation. You’ll see their answer here."
      />
    );
  }

  return (
    <AuthLayout
      title={title}
      footer={
        <div className="flex flex-col gap-5">
          {!locked && (
            <details>
              <summary className="inline-flex min-h-11 cursor-pointer items-center text-fg">Need to talk to someone?</summary>
              <CrisisResources headingLevel={2} title="Help is one call away" className="mt-3" />
            </details>
          )}
          {record && !locked && <AccountExit />}
          <div>
            <Button variant="ghost" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      }
    >
      {body}
    </AuthLayout>
  );
}

export default function TeenPage() {
  return (
    <RequireAuth requireOnboarded={false} enforceGates={false}>
      <Teen />
    </RequireAuth>
  );
}
