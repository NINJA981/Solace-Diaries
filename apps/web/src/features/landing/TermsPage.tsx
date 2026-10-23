import { Link } from 'react-router';
import { LegalLayout, LegalSection } from './LegalLayout';

export default function TermsPage() {
  return (
    <LegalLayout
      title="Terms"
      updated="Draft, October 2026"
      intro={<p>The short version: your journal is yours, use Solace kindly, and remember that its AI can be wrong.</p>}
    >
      <LegalSection title="Your account">
        <p>
          You need an account to use Solace. Keep your sign-in details to yourself, and tell us at [contact email] if you
          think someone else has access. You must be at least [16] to use Solace.
        </p>
      </LegalSection>

      <LegalSection title="Your writing belongs to you">
        <p>
          You own everything you write and upload. You give us permission to store, process and display it only to run
          Solace for you, including sending it to our AI provider as described in the{' '}
          <Link to="/privacy" className="text-accent underline underline-offset-4">
            privacy policy
          </Link>
          . That permission ends when you delete the content or your account.
        </p>
      </LegalSection>

      <LegalSection title="About the AI features">
        <p>
          Moods, tags, summaries, memories, Reflect answers and weekly letters are generated automatically and can be
          incomplete or wrong. Solace links answers to the entries they draw on so you can check them.
        </p>
        <p>
          <strong>Solace isn’t therapy or medical advice.</strong> If you’re in crisis or thinking about harming yourself,
          contact local emergency services or a crisis line in your country right away.
        </p>
      </LegalSection>

      <LegalSection title="Fair use">
        <ul>
          <li>Don’t use Solace to break the law, or to store content that exploits or harms others.</li>
          <li>Don’t try to access other people’s data, disrupt the service, or get around usage limits.</li>
          <li>AI features have a daily limit so the service stays available for everyone.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Availability and changes">
        <p>
          We work to keep Solace running and your data safe, but we can’t promise it will always be available or free of
          errors. Export your journal regularly if it matters to you. We may change or end features; if we ever shut
          Solace down, we’ll give at least [30] days’ notice so you can export everything.
        </p>
      </LegalSection>

      <LegalSection title="Ending your account">
        <p>
          You can delete your account at any time in Settings. We may suspend accounts that break these terms, and will
          tell you why unless the law prevents it.
        </p>
      </LegalSection>

      <LegalSection title="Liability">
        <p>
          Solace is provided as is. To the extent the law allows, we aren’t liable for indirect or consequential losses,
          and our total liability is limited to [amount]. Nothing here limits rights you have under consumer law.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          These terms are governed by the laws of [jurisdiction]. Questions: [contact email]. Solace is operated by
          [operator name and address].
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
