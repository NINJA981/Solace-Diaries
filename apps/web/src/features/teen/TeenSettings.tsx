import type { Profile } from '@solace/shared';
import type { ReactNode } from 'react';
import { CrisisResources } from './CrisisResources';

/** Settings → Teen account: status, who approved and when, and what is different. */
export function TeenAccountPanel({ profile }: { profile: Profile }) {
  const when = profile.consentDecidedAt
    ? new Date(profile.consentDecidedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const status: Record<Profile['consentStatus'], ReactNode> = {
    granted: when ? `Approved by a parent or guardian on ${when}.` : 'Approved by a parent or guardian.',
    pending: 'Waiting for a parent or guardian to approve.',
    revoked: 'A parent or guardian has declined or withdrawn their approval.',
    not_required: 'No approval needed.',
  };
  return (
    <div className="flex max-w-prose flex-col gap-5">
      <p role="status" className="rounded-card border border-line bg-surface p-4 leading-relaxed text-fg">
        {status[profile.consentStatus]}
      </p>
      <div>
        <h3 className="font-medium text-fg">What’s different on a teen account</h3>
        <ul className="mt-2 list-disc pl-5 leading-relaxed text-fg-muted [&_li]:mt-1.5">
          <li>No streak counters or reminders to keep writing.</li>
          <li>No share cards and no map of the people in your journal.</li>
          <li>The AI only notes your own goals, habits and feelings, not facts about other people.</li>
          <li>Help-line numbers are always one tap away.</li>
        </ul>
      </div>
      <div>
        <h3 className="font-medium text-fg">If your parent changes their mind</h3>
        <p className="mt-2 leading-relaxed text-fg-muted">
          They can withdraw approval at any time from the link in the email we sent them. Your account then locks right
          away. Nothing is deleted: you can still download your journal or delete the account.
        </p>
      </div>
    </div>
  );
}

/** Settings → Need to talk to someone? Always visible, for everyone. */
export function HelpPanel() {
  return <CrisisResources headingLevel={3} title="Help lines" />;
}
