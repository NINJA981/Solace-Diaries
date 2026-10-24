import { config } from '@/lib/config';
import { LegalLayout, LegalSection } from './LegalLayout';

export default function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy"
      updated="Draft, October 2026"
      intro={
        <p>
          Solace is a journal, so privacy isn’t a feature here; it’s the point. This page explains what we keep, why, who
          else touches it, and how you can take it with you or erase it.
        </p>
      }
    >
      <LegalSection title="What we collect">
        <ul>
          <li>
            <strong>Your account:</strong> your email address and, if you use one, a password. Passwords are handled by
            our sign-in provider and stored only as a secure hash. If you sign in with Google, we receive your email
            address and basic profile from Google.
          </li>
          <li>
            <strong>What you write:</strong> entries, titles, dates, moods, tags and photos; your questions in Reflect and
            the answers; and the memories, summaries and weekly letters Solace creates from your entries.
          </li>
          <li>
            <strong>Your settings:</strong> name, timezone, reminder hour and reflection voice.
          </li>
          <li>
            <strong>Technical logs:</strong> request times, IP addresses and error details, used to keep the service secure
            and working, and kept for [30] days. Logs never contain your entries or your Gemini key.
          </li>
        </ul>
        <p>We don’t use advertising or analytics trackers.</p>
      </LegalSection>

      <LegalSection title="How we use it">
        <p>
          Only to run Solace for you: storing and syncing your journal, searching it, and powering the AI features you
          use. We don’t sell your data, share it with advertisers, or use your journal to train AI models ourselves.
        </p>
      </LegalSection>

      <LegalSection title="AI processing with Google Gemini">
        <p>
          Solace’s AI features run on Google’s Gemini API. When you save an entry, the text is sent to Gemini to suggest a
          mood, tags and a summary, to create the search index that lets Solace find entries by meaning, and to note
          memories. When you ask Reflect a question or open your weekly letter, the question and the relevant passages from
          your entries are sent too.
        </p>
        {config.aiTier === 'paid' ? (
          <p>
            Solace uses Google’s paid Gemini API. Under those terms, Google doesn’t use your prompts or the responses to
            improve its products. So neither Solace nor Google trains AI on your journal.
          </p>
        ) : (
          <p>
            Solace currently uses the free tier of Google’s Gemini API. Under Google’s terms for unpaid services, Google
            may use the prompts and responses to improve its products, and human reviewers may read them. Solace itself
            doesn’t train AI on your journal. Until Solace moves to the paid API, under which Google doesn’t use them,
            leave out anything you wouldn’t want a reviewer to read.
          </p>
        )}
        <p>
          If you add your own Gemini key in Settings, it stays in your browser and is sent with each request. We never
          store or log it. Requests made with your key fall under Google’s terms for that key: on the free tier, Google
          may use them to improve its products.
        </p>
      </LegalSection>

      <LegalSection title="Where your data lives">
        <ul>
          <li>
            <strong>Supabase</strong> hosts sign-in, the Postgres database that holds your journal, and the private storage
            for photos, in [region]. Data is encrypted in transit and at rest.
          </li>
          <li>
            <strong>Render</strong> runs the Solace API, and <strong>Vercel</strong> serves the web app. Neither stores your
            journal.
          </li>
          <li>
            <strong>Photos</strong> are re-encoded to remove location and camera details, kept in private storage, and
            shown through links that expire after about an hour.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="On your device">
        <p>
          Solace uses your browser’s storage for your sign-in session, your theme, unsaved drafts (so nothing is lost
          offline), and your Gemini key if you add one. The installable app caches only the app itself, never your
          journal.
        </p>
      </LegalSection>

      <LegalSection title="Your choices">
        <ul>
          <li>
            <strong>See and correct:</strong> every memory Solace keeps is listed in Insights, where you can edit, archive
            or delete it. You can edit or delete any entry.
          </li>
          <li>
            <strong>Export:</strong> download your whole journal as Markdown or JSON from Settings at any time.
          </li>
          <li>
            <strong>Delete:</strong> deleting your account in Settings immediately removes your account, entries, photos,
            conversations and memories from our live systems. Encrypted backups kept by our database provider roll off
            within [7] days.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Children">
        <p>Solace isn’t intended for anyone under [16]. If you believe a child has created an account, contact us and we’ll delete it.</p>
      </LegalSection>

      <LegalSection title="Teen accounts (13 to 17)">
        <p>
          People aged 13 to 17 can use Solace with a parent or guardian’s approval. People under 13 can’t have an
          account: if someone tells us they’re under 13, the account is deleted straight away.
        </p>
        <ul>
          <li>
            <strong>Age:</strong> at sign-up we ask for the month and year you were born, work out an age range (13 to 15,
            16 to 17, or 18 and over), and keep only the range. We never store the birth date, and the range can’t be
            changed afterwards.
          </li>
          <li>
            <strong>Parent approval:</strong> a teen account stays locked until a parent or guardian approves it from an
            emailed link. We store the time of their decision, the version of these terms, and a one-way fingerprint
            (hash) of their email address and of the link, never the address itself. They can withdraw approval at any
            time from the same link, which locks the account straight away. A teen can still download or delete their
            journal.
          </li>
          <li>
            <strong>What a parent can see:</strong> the teen’s first name and the status of the request. Parents can’t
            read the journal.
          </li>
          <li>
            <strong>What’s different:</strong> no streak counters or reminders, no share cards, no map of the people in
            the journal, and the AI doesn’t record facts about other people, only the teen’s own goals, habits and
            feelings. Help-line numbers are always one tap away.
          </li>
          <li>
            <strong>AI processing:</strong> the same as for everyone else: entry text goes to Google Gemini
            {config.aiTier === 'paid'
              ? ', under paid terms that don’t allow Google to use it to improve its products.'
              : ', on the free tier, where Google may use it to improve its products and reviewers may read it.'}
          </li>
        </ul>
        <p>
          Laws on children’s data differ by country (for example India’s DPDP rules and the EU’s GDPR, where the
          age of digital consent is between 13 and 16). Teen sign-up is not yet available everywhere.
        </p>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <p>
          If we change how we handle your data, we’ll update this page and tell you in the app before the change takes
          effect. Questions or requests: [contact email]. Solace is operated by [operator name and address].
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
