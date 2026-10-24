import type { ConsentView } from '@solace/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Spinner } from '@/components/ui/Spinner';
import { PublicPage } from '@/features/landing/PublicChrome';
import { api } from '@/lib/api';
import { config } from '@/lib/config';
import { isApiError } from '@/lib/errors';

type Decision = 'grant' | 'deny' | 'revoke';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="type-heading text-2xl leading-snug text-fg">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 leading-relaxed text-fg-muted [&_li]:mt-1.5 [&_strong]:font-medium [&_strong]:text-fg [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

export function ParentFaq({ name }: { name: string }) {
  const item = 'border-t border-line py-3 first:border-t-0';
  const summary = 'flex min-h-11 cursor-pointer items-center font-medium text-fg';
  return (
    <div className="rounded-card border border-line bg-surface px-5">
      <details className={item}>
        <summary className={summary}>Can I read {name}’s journal?</summary>
        <p className="pb-2">
          No. The journal is {name}’s private space, and this link only lets you approve, decline or withdraw. If you’re
          worried about {name}, talking together is the best route. Solace also shows help-line numbers inside the app.
        </p>
      </details>
      <details className={item}>
        <summary className={summary}>What if I say no?</summary>
        <p className="pb-2">
          Nothing is used. {name}’s account stays locked, and {name} can download or delete anything they wrote. If
          you decline, {name} can send a new request. If you later withdraw approval, the account stays locked.
        </p>
      </details>
      <details className={item}>
        <summary className={summary}>Can I change my mind?</summary>
        <p className="pb-2">
          Yes, at any time, from this same link. Choosing “Withdraw approval” locks the account straight away.
        </p>
      </details>
      <details className={item}>
        <summary className={summary}>Do you keep my email address?</summary>
        <p className="pb-2">
          No. We keep a one-way fingerprint of it (a hash) and the time you decided, so we can show that consent was
          given. The fingerprint can’t be turned back into your address.
        </p>
      </details>
      <details className={item}>
        <summary className={summary}>How is the data deleted?</summary>
        <p className="pb-2">
          {name} can delete the account from Settings at any time, which erases every entry, photo and memory right
          away. The consent record goes with it. Questions or requests: see our{' '}
          <Link className="text-fg underline" to="/privacy">
            privacy page
          </Link>
          .
        </p>
      </details>
      <details className={item}>
        <summary className={summary}>Why am I being asked?</summary>
        <p className="pb-2">
          Laws in many countries expect a parent or guardian to agree before a young teenager uses an online service
          that handles personal information. We want to do this properly rather than just ask for a tick-box.
        </p>
      </details>
    </div>
  );
}

function NotValid() {
  return (
    <div className="mx-auto max-w-[40rem] px-5 pt-14 pb-24 sm:px-8">
      <h1 className="type-title text-4xl leading-tight text-fg">This link isn’t working</h1>
      <p className="mt-4 leading-relaxed text-fg-muted">
        It may have expired (links last 7 days until you answer), been replaced by a newer email, or been copied
        incorrectly. Nothing has happened to anyone’s account.
      </p>
      <p className="mt-3 leading-relaxed text-fg-muted">
        If you’re a parent or guardian, ask your teen to send a new email from the Solace sign-in screen. If you
        weren’t expecting this, you can safely ignore it.
      </p>
    </div>
  );
}

const STATUS_COPY: Record<Exclude<ConsentView['status'], 'pending' | 'expired'>, (name: string) => { title: string; text: string }> = {
  granted: (n) => ({
    title: `You approved ${n}’s account`,
    text: `${n} can now use Solace in teen mode. You can withdraw your approval at any time from this page.`,
  }),
  denied: (n) => ({
    title: 'You declined',
    text: `${n}’s account stays locked and nothing is used. You don’t need to do anything else.`,
  }),
  revoked: (n) => ({
    title: 'Approval withdrawn',
    text: `${n}’s account is locked. ${n} can still download or delete what they wrote.`,
  }),
};

function ConsentContent({ view, token }: { view: ConsentView; token: string }) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<Decision | null>(null);
  const [decided, setDecided] = useState(false);
  const statusRef = useRef<HTMLHeadingElement>(null);
  const name = view.teenFirstName;

  // After a decision, move focus to the new status heading so it is announced.
  useEffect(() => {
    if (decided) statusRef.current?.focus();
  }, [decided, view.status]);

  const decide = async (decision: Decision) => {
    const next = await api.decideConsent({ params: { token }, body: { decision } });
    queryClient.setQueryData(['consent', token], next);
    setDecided(true);
  };

  const free = config.aiTier === 'free';
  const pending = view.status === 'pending';
  const done = view.status === 'pending' || view.status === 'expired' ? null : STATUS_COPY[view.status](name);

  return (
    <div className="mx-auto max-w-[40rem] px-5 pt-12 pb-24 sm:px-8 sm:pt-16">
      {done ? (
        <div role="status" aria-live="polite" className="rounded-card border border-line bg-surface p-6">
          <h1 ref={statusRef} tabIndex={-1} className="type-title text-3xl leading-tight text-fg outline-none">
            {done.title}
          </h1>
          <p className="mt-3 leading-relaxed text-fg-muted">{done.text}</p>
          {view.status === 'granted' && (
            <div className="mt-5">
              <Button variant="danger" onClick={() => setAsking('revoke')}>
                Withdraw approval
              </Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <h1 ref={statusRef} tabIndex={-1} className="type-title text-4xl leading-tight text-fg outline-none">
            {name} would like to use Solace
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-fg-muted">
            {name} is between 13 and 17, so we need a parent or guardian to say yes first. Nothing is used until you do.
            It takes about two minutes to read.
          </p>
        </>
      )}

      {pending && (
        <>
          <Section title="What Solace is">
            <p>
              Solace is a private journaling app. {name} writes entries (and can add photos), and an AI helps with a
              short summary, a mood, search, and gentle reflection prompts.
            </p>
          </Section>

          <Section title="What is stored">
            <ul>
              <li>
                <strong>{name}’s journal:</strong> entries, photos, moods and tags, questions asked in Reflect and the
                answers, and the summaries and notes Solace makes from them.
              </li>
              <li>
                <strong>Account details:</strong> {name}’s email address, name, and settings. Their birth date is{' '}
                <strong>not</strong> stored, only an age range.
              </li>
              <li>
                <strong>Your decision:</strong> the time, the policy version, and a one-way fingerprint of your email
                address. Not your address itself.
              </li>
            </ul>
          </Section>

          <Section title="Who handles it">
            <ul>
              <li>
                <strong>Google Gemini</strong> reads entry text to write summaries, find related entries and answer
                questions.
              </li>
              <li>
                <strong>Supabase</strong> stores the account, database and photos; <strong>Render</strong> runs the
                server; <strong>Vercel</strong> serves the website.
              </li>
            </ul>
            {free ? (
              <p>
                <strong>Please note:</strong> Solace currently uses Google’s free Gemini service. Under Google’s terms for
                free services, Google may use what is sent to improve its products, and people at Google may review some of
                it. Solace itself doesn’t train AI on journals, doesn’t sell data, and shows no ads.
              </p>
            ) : (
              <p>
                Solace uses Google’s paid Gemini service, under which Google doesn’t use what is sent to train its models.
                Solace doesn’t sell data and shows no ads.
              </p>
            )}
          </Section>

          <Section title="What teen mode does differently">
            <ul>
              <li>No streak counters or reminders to keep writing.</li>
              <li>No share cards, and no map of the people in the journal.</li>
              <li>The AI doesn’t record facts about other people, only {name}’s own goals, habits and feelings.</li>
              <li>Help-line numbers (including for India) are always one tap away.</li>
              <li>{name} can download or delete everything at any time.</li>
            </ul>
          </Section>

          <Section title="What you are agreeing to">
            <p>
              That {name} may use Solace in teen mode, with their journal handled as described above. You can’t read
              the journal through this page. You can withdraw approval later from this same link, and the account locks
              straight away.
            </p>
          </Section>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row" role="group" aria-label="Your decision">
            <Button className="h-12 flex-1 px-6 text-base" onClick={() => setAsking('grant')}>
              Approve {name}’s account
            </Button>
            <Button variant="secondary" className="h-12 flex-1 px-6 text-base" onClick={() => setAsking('deny')}>
              Decline
            </Button>
          </div>
          <p className="mt-3 text-xs text-fg-muted">
            Policy version {view.policyVersion}. This link works until{' '}
            {new Date(view.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.
          </p>
        </>
      )}

      <Section title="Questions parents ask">
        <ParentFaq name={name} />
      </Section>

      <ConfirmDialog
        open={asking === 'grant'}
        onOpenChange={(o) => !o && setAsking(null)}
        title={`Approve ${name}’s account?`}
        description={`${name} will be able to use Solace in teen mode straight away. You can withdraw approval later from this link.`}
        confirmLabel="Yes, approve"
        cancelLabel="Go back"
        onConfirm={() => decide('grant')}
      />
      <ConfirmDialog
        open={asking === 'deny'}
        onOpenChange={(o) => !o && setAsking(null)}
        title="Decline this request?"
        description={`${name}’s account stays locked and nothing is used. ${name} will see that you declined.`}
        confirmLabel="Yes, decline"
        cancelLabel="Go back"
        onConfirm={() => decide('deny')}
      />
      <ConfirmDialog
        open={asking === 'revoke'}
        onOpenChange={(o) => !o && setAsking(null)}
        tone="danger"
        title="Withdraw approval?"
        description={`${name}’s account locks right away. ${name} can still download or delete their journal.`}
        confirmLabel="Withdraw approval"
        cancelLabel="Keep approval"
        onConfirm={() => decide('revoke')}
      />
    </div>
  );
}

export default function ConsentPage() {
  const { token = '' } = useParams();
  const { data, error, isPending } = useQuery({
    queryKey: ['consent', token],
    queryFn: ({ signal }) => api.viewConsent({ params: { token }, signal }),
    retry: (count, err) => !(isApiError(err) && err.status < 500) && count < 2,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  return (
    <PublicPage>
      {isPending ? (
        <div className="grid place-items-center py-32 text-fg-muted">
          <Spinner label="Loading" size={22} />
        </div>
      ) : data ? (
        <ConsentContent view={data} token={token} />
      ) : isApiError(error) && error.status >= 500 ? (
        <div className="mx-auto max-w-[40rem] px-5 pt-14 pb-24 sm:px-8">
          <h1 className="type-title text-4xl leading-tight text-fg">We couldn’t load this just now</h1>
          <p className="mt-4 leading-relaxed text-fg-muted">Please try again in a minute. Nothing has been decided.</p>
        </div>
      ) : (
        <NotValid />
      )}
    </PublicPage>
  );
}
