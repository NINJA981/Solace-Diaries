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
          use. We don’t sell your data, share it with advertisers, or use your journal to train AI models.
        </p>
      </LegalSection>

      <LegalSection title="AI processing with Google Gemini">
        <p>
          Solace’s AI features run on Google’s Gemini API. When you save an entry, the text is sent to Gemini to suggest a
          mood, tags and a summary, to create the search index that lets Solace find entries by meaning, and to note
          memories. When you ask Reflect a question or open your weekly letter, the question and the relevant passages from
          your entries are sent too.
        </p>
        <p>
          Solace uses Google’s paid Gemini API. Under those terms, Google doesn’t use your prompts or the responses to
          improve its products. So neither Solace nor Google trains AI on your journal.
        </p>
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

      <LegalSection title="Changes and contact">
        <p>
          If we change how we handle your data, we’ll update this page and tell you in the app before the change takes
          effect. Questions or requests: [contact email]. Solace is operated by [operator name and address].
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
