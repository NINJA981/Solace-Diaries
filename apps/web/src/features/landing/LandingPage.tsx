import { Suspense } from 'react';
import { Link } from 'react-router';
import { config } from '@/lib/config';
import { buttonClasses } from '@/components/ui/Button';
import { PublicFooter, PublicHeader } from './PublicChrome';
import { useWorldManifest } from '@/worlds';
import { SkipLink } from '@/components/layout/SkipLink';
import { ReflectGlimpse } from './ReflectGlimpse';

const STEPS = [
  {
    title: 'Write',
    body: 'A line or a page, whenever you like. Solace saves as you type, keeps working offline, and lets you add a photo.',
  },
  {
    title: 'Solace remembers',
    body: 'After each entry it notes the mood, the people, places and plans you mention, and links them to what you wrote before.',
  },
  {
    title: 'Look back',
    body: 'Ask your past a question, or open Insights to see your streaks, how your mood has moved, and a short letter about your week.',
  },
];

const TRAINING_PROMISE =
  config.aiTier === 'paid'
    ? {
        title: 'Never used for training',
        body: 'Solace doesn’t train AI on your journal, and neither does Google: we use the paid Gemini API, which keeps your words out of training. We never sell or share them.',
      }
    : {
        title: 'Never sold, never trained on by us',
        body: 'Solace doesn’t train AI on your journal and never sells or shares it. While we’re on Google’s free Gemini tier, Google may use AI requests to improve its products.',
      };

const PROCESSOR_PROMISE =
  config.aiTier === 'paid'
    ? 'AI features run on Google’s paid Gemini API. Only the text each request needs is sent there to be processed.'
    : 'AI features run on Google’s Gemini API, on its free tier for now. Only the text each request needs is sent, and Google may use it to improve its products.';

const PROMISES = [
  {
    title: 'Encrypted at rest',
    body: 'Entries live in an encrypted database tied to your account. Nobody else sees them in the app.',
  },
  TRAINING_PROMISE,
  {
    title: 'Private photos',
    body: 'Photos are stored privately and shown through links that expire after an hour.',
  },
  {
    title: 'Yours to take or delete',
    body: 'Export everything as Markdown or JSON at any time. Deleting your account erases it right away.',
  },
  {
    title: 'You can see what it remembers',
    body: 'Every memory Solace keeps is listed in Insights, where you can edit or delete it.',
  },
  {
    title: 'Who processes your words',
    body: PROCESSOR_PROMISE,
  },
];

const FAQ = [
  {
    q: 'Do I have to write every day?',
    a: 'No. Streaks are there if they help you, and you can turn on a gentle daily reminder that only appears inside the app. Solace never sends nagging emails.',
  },
  {
    q: 'What exactly does Solace remember?',
    a: 'People, places, goals, habits and feelings that come up in your entries. Each one links back to the entries it came from, and you can edit, archive or delete it.',
  },
  {
    q: 'Can Reflect get things wrong?',
    a: 'It can. That’s why it answers only from your own entries and links every source, so you can check. When your journal doesn’t cover something, it says so instead of guessing.',
  },
  {
    q: 'Does it work on my phone?',
    a: 'Yes, in any modern browser. You can add it to your home screen, and anything you write offline is saved and synced when you’re back online.',
  },
  {
    q: 'Can I use my own Gemini API key?',
    a: 'Yes, if you’d like to. Add it in Settings on a device; it’s kept in that browser only, sent along with your requests, and never stored in our database. Google’s terms for your key then apply, and free-tier keys may let Google use requests to improve its products.',
  },
  {
    q: 'How do I leave?',
    a: 'Export your journal from Settings, then delete your account there. Deletion is immediate; encrypted backups roll off on their normal schedule.',
  },
];

/** Holds the hero's place while a world's lazy hero loads, so nothing below it jumps. */
function HeroPlaceholder() {
  return <div aria-hidden="true" className="min-h-[22rem] lg:mt-6" />;
}

export default function LandingPage() {
  // Each world brings its own hero (Lamplight's is the RememberingScene night sky).
  const { Hero } = useWorldManifest();
  return (
    <div className="min-h-dvh overflow-x-clip bg-canvas">
      <SkipLink />
      <PublicHeader />
      <main id="main" tabIndex={-1} className="outline-none">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-x-16 gap-y-10 px-5 pt-10 pb-20 sm:px-8 sm:pt-16 lg:min-h-[min(46rem,calc(100svh-4rem))] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:pt-4 lg:pb-24">
          <div className="max-w-xl">
            <h1 className="type-display text-5xl leading-display text-fg">
              A private journal that remembers.
            </h1>
            <p className="mt-6 max-w-[34rem] leading-relaxed text-fg-muted sm:text-lg">
              Write the way you would in a notebook. Solace keeps track of the people, places and patterns in your
              entries, so later you can ask your past a question and get an answer in your own words.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link to="/signup" className={buttonClasses('primary', 'md', 'h-12 px-6 text-base')}>
                Start your journal
              </Link>
              <a href="#how" className={buttonClasses('ghost', 'md', 'h-12 px-4 text-base text-fg')}>
                See how it works
              </a>
            </div>
            <p className="mt-5 text-sm text-fg-faint">Private by default. Export or delete everything, anytime.</p>
          </div>
          <Suspense fallback={<HeroPlaceholder />}>
            <Hero className="lg:mt-6" />
          </Suspense>
        </section>

        {/* How it works: a real sequence, drawn as three joined stars */}
        <section id="how" aria-labelledby="how-title" className="scroll-mt-8 border-t border-line">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
            <h2 id="how-title" className="max-w-xl type-heading text-3xl leading-tight text-fg sm:text-4xl">
              You write. Solace remembers. Later, you can look back.
            </h2>
            <ol className="relative mt-14 grid gap-12 md:grid-cols-3 md:gap-10">
              <span
                aria-hidden="true"
                className="absolute top-[7px] right-[16%] left-[7px] hidden h-px bg-gradient-to-r from-ai/70 via-ai/40 to-ai/10 md:block"
              />
              {STEPS.map((step, i) => (
                <li key={step.title} className="relative pl-8 md:pl-0">
                  <span
                    aria-hidden="true"
                    className="absolute top-[1px] left-0 grid size-[14px] place-items-center md:relative md:top-0 md:mb-7"
                  >
                    <span className="size-[9px] rounded-full bg-accent shadow-[0_0_14px_3px_var(--accent-glow)]" />
                  </span>
                  <h3 className="type-heading text-xl leading-snug font-medium text-fg md:text-2xl">
                    <span className="sr-only">Step {i + 1}: </span>
                    {step.title}
                  </h3>
                  <p className="mt-3 max-w-[22rem] leading-relaxed text-fg-muted">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Product glimpse */}
        <section aria-labelledby="reflect-title" className="border-t border-line bg-surface/40">
          <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
            <div className="max-w-md">
              <h2 id="reflect-title" className="type-heading text-3xl leading-tight text-fg sm:text-4xl">
                Ask your past a question
              </h2>
              <p className="mt-5 leading-relaxed text-fg-muted">
                Reflect answers from what you’ve written, and nothing else. Each part of an answer links to the entry it
                came from, so you can read it again in context.
              </p>
              <p className="mt-4 leading-relaxed text-fg-muted">
                Choose the voice that suits you: gentle, direct, curious or stoic.
              </p>
            </div>
            <ReflectGlimpse />
          </div>
        </section>

        {/* Privacy */}
        <section aria-labelledby="privacy-title" className="border-t border-line">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
              <div className="max-w-md">
                <h2 id="privacy-title" className="type-heading text-3xl leading-tight text-fg sm:text-4xl">
                  What happens to what you write
                </h2>
                <p className="mt-5 leading-relaxed text-fg-muted">
                  A journal only works if you can be honest in it. Here is exactly how Solace handles your words.
                </p>
                <Link
                  to="/privacy"
                  className="mt-6 inline-flex min-h-11 items-center text-sm font-medium text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent sm:min-h-0"
                >
                  Read the privacy policy
                </Link>
              </div>
              <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
                {PROMISES.map((p) => (
                  <div key={p.title} className="border-t border-line pt-5">
                    <dt className="font-medium text-fg">{p.title}</dt>
                    <dd className="mt-2 text-sm leading-relaxed text-fg-muted">{p.body}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* FAQ */}
        {/* Same split as the privacy section: heading on the left edge, answers on the right. */}
        <section aria-labelledby="faq-title" className="border-t border-line">
          <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-10 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
            <div className="max-w-md">
              <h2 id="faq-title" className="type-heading text-3xl leading-tight text-fg sm:text-4xl">
                Questions
              </h2>
            </div>
            <div className="divide-y divide-line border-y border-line">
              {FAQ.map((item) => (
                <details key={item.q} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left font-medium text-fg [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      className="size-4 shrink-0 text-fg-faint transition-transform duration-(--dur-2) group-open:rotate-45"
                    >
                      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </summary>
                  <p className="max-w-2xl pb-6 leading-relaxed text-fg-muted">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final call to action */}
        <section aria-labelledby="cta-title" className="relative isolate overflow-hidden border-t border-line">
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-[radial-gradient(45%_70%_at_50%_100%,var(--accent-soft),transparent_70%)]"
          />
          <div className="mx-auto max-w-3xl px-5 py-24 text-center sm:px-8 sm:py-32">
            <h2 id="cta-title" className="type-display text-4xl leading-tight tracking-title text-fg sm:text-5xl">
              Start with one sentence tonight.
            </h2>
            <p className="mx-auto mt-5 max-w-md text-lg leading-relaxed text-fg-muted">
              Solace will remember it, and everything after.
            </p>
            <Link to="/signup" className={buttonClasses('primary', 'md', 'mt-9 h-12 px-6 text-base')}>
              Start your journal
            </Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
