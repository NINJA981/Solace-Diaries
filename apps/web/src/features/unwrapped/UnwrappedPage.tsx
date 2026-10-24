import { createPortal } from 'react-dom';
import { useEffect, useMemo, useReducer, useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { localDate, MOODS, type EntrySummary, type Mood, type Unwrapped, type UnwrappedSlide } from '@solace/shared';
import { Button, Select, VisuallyHidden, buttonClasses } from '@/components/ui';
import { ApiRequestError } from '@/lib/api';
import { play } from '@/lib/feedback';
import { useProfile, useTimezone } from '@/lib/session';
import { useVoice } from '@/lib/voice';
import { InlineError } from '../journal-core/EntryCard';
import { formatLongDay, formatNumber, moodLabel, moodStepFor, plural } from '../journal-core/format';
import { useUnwrapped } from '../journal-core/queries-v3b';
import {
  WEEKDAYS,
  WEEKDAYS_LONG,
  buildStory,
  defaultMonth,
  hourLabel,
  isNotEnough,
  keyToNav,
  monthOptions,
  navReduce,
  swipeToNav,
  yearOptions,
  type StorySlide,
} from './story';
import './unwrapped.css';

const monthName = (m: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T12:00:00Z`));

const rise = (i: number): CSSProperties => ({ ['--i' as string]: i });

// ───────────────────────── slide pieces ─────────────────────────

function Headline({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <>
      <p className="u-rise text-sm font-medium tracking-wide text-ai uppercase" style={rise(0)}>
        {kicker}
      </p>
      <h2 className="u-rise type-heading mt-3 max-w-[22ch] text-4xl leading-tight text-fg sm:text-5xl" style={rise(1)}>
        {children}
      </h2>
    </>
  );
}

function Big({ value, label, i }: { value: number; label: string; i: number }) {
  return (
    <div className="u-rise" style={rise(i)}>
      <dd className="type-heading text-5xl leading-none text-fg tabular-nums sm:text-6xl">{formatNumber(value)}</dd>
      <dt className="mt-2 text-sm text-fg-muted">{label}</dt>
    </div>
  );
}

function HourChart({ byHour, peak }: { byHour: number[]; peak: number | null }) {
  const max = Math.max(1, ...byHour);
  const W = 480;
  const H = 120;
  const bw = W / 24;
  return (
    <figure className="u-rise" style={rise(3)}>
      <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label="Entries by hour of the day" className="w-full max-w-xl overflow-visible">
        {byHour.map((n, h) => {
          const bh = n === 0 ? 2 : Math.max(4, (n / max) * H);
          const isPeak = h === peak;
          return (
            <rect
              key={h}
              className="u-bar-y"
              style={rise(h)}
              x={h * bw + 2}
              y={H - bh}
              width={bw - 4}
              height={bh}
              rx={3}
              fill={isPeak ? 'var(--accent)' : 'var(--ai)'}
              fillOpacity={isPeak ? 1 : n === 0 ? 0.25 : 0.6}
            />
          );
        })}
        {[0, 6, 12, 18].map((h) => (
          <text key={h} x={h * bw + 2} y={H + 16} fontSize={11} fill="var(--fg-muted)">
            {hourLabel(h)}
          </text>
        ))}
      </svg>
      <VisuallyHidden>
        <table>
          <caption>Entries by hour</caption>
          <thead>
            <tr>
              <th scope="col">Hour</th>
              <th scope="col">Entries</th>
            </tr>
          </thead>
          <tbody>
            {byHour.map((n, h) => (
              <tr key={h}>
                <th scope="row">{hourLabel(h)}</th>
                <td>{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </VisuallyHidden>
    </figure>
  );
}

function BarRows({ rows, color }: { rows: { key: string; label: string; n: number; color: string }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <ul className="w-full max-w-md space-y-2.5">
      {rows.map((r, i) => (
        <li key={r.key} className="u-rise grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3 text-sm" style={rise(i + 2)}>
          <span className="truncate text-fg">{r.label}</span>
          <span className="h-3 rounded-full bg-sunken" aria-hidden="true">
            <span className="u-bar-x block h-full rounded-full" style={{ ...rise(i), width: `${Math.max(4, (r.n / max) * 100)}%`, background: color ?? r.color }} />
          </span>
          <span className="text-right text-fg-muted tabular-nums">{r.n}</span>
        </li>
      ))}
    </ul>
  );
}

function EntryLink({ entry, caption, i }: { entry: EntrySummary; caption: string; i: number }) {
  return (
    <Link
      to={`/app/entries/${entry.id}`}
      className="u-rise block max-w-md rounded-card border border-line bg-surface px-5 py-4 shadow-1 transition-colors hover:border-ai/50"
      style={rise(i)}
    >
      <span className="text-xs font-medium tracking-wide text-ai uppercase">{caption}</span>
      <span className="mt-1 block font-prose text-lg text-fg">{entry.title.trim() || 'Untitled'}</span>
      <span className="mt-0.5 block text-sm text-fg-muted">{formatLongDay(entry.entryDate)}</span>
      {entry.excerpt && <span className="mt-2 line-clamp-2 block font-prose text-note text-fg-muted">{entry.excerpt}</span>}
    </Link>
  );
}

function SlideBody({ slide, label }: { slide: UnwrappedSlide; label: string }) {
  switch (slide.kind) {
    case 'totals':
      return (
        <>
          <Headline kicker={label}>{plural(slide.entries, 'entry', 'entries')} in {slide.days === 1 ? 'one day' : `${slide.days} days`}.</Headline>
          <dl className="mt-10 grid grid-cols-3 gap-6">
            <Big value={slide.entries} label={slide.entries === 1 ? 'entry' : 'entries'} i={2} />
            <Big value={slide.words} label="words" i={3} />
            <Big value={slide.days} label={slide.days === 1 ? 'day you wrote' : 'days you wrote'} i={4} />
          </dl>
        </>
      );
    case 'moods': {
      const rows = (MOODS as readonly Mood[])
        .map((m) => ({ key: m, label: moodLabel(m), n: slide.counts[m] ?? 0, color: `var(--mood-${moodStepFor(m)})` }))
        .filter((r) => r.n > 0)
        .sort((a, b) => b.n - a.n);
      return (
        <>
          <Headline kicker={label}>{slide.top ? `${moodLabel(slide.top)} came up most.` : 'How it felt.'}</Headline>
          <div className="mt-8">
            <BarRows rows={rows} />
          </div>
        </>
      );
    }
    case 'tags':
      return (
        <>
          <Headline kicker={label}>You kept coming back to {slide.top[0]?.tag}.</Headline>
          <div className="mt-8">
            <BarRows rows={slide.top.slice(0, 6).map((t) => ({ key: t.tag, label: t.tag, n: t.count, color: 'var(--ai)' }))} color="var(--ai)" />
          </div>
        </>
      );
    case 'streak':
      return (
        <>
          <Headline kicker={label}>
            {slide.longest > 1 ? `${slide.longest} days in a row at your best.` : 'Every day you wrote counts.'}
          </Headline>
          <dl className="mt-10 grid grid-cols-2 gap-6">
            <Big value={slide.longest} label="longest run of days" i={2} />
            <Big value={slide.current} label="days in a row now" i={3} />
          </dl>
        </>
      );
    case 'rhythm': {
      const maxDay = Math.max(1, ...slide.byWeekday);
      const topDay = slide.byWeekday.indexOf(Math.max(...slide.byWeekday));
      return (
        <>
          <Headline kicker={label}>
            {slide.peakHour === null ? 'Your writing rhythm.' : `You wrote most around ${hourLabel(slide.peakHour)}.`}
          </Headline>
          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            <HourChart byHour={slide.byHour} peak={slide.peakHour} />
            <figure className="u-rise" style={rise(4)}>
              <ul className="max-w-sm space-y-1.5" aria-label="Entries by weekday">
                {slide.byWeekday.map((n, d) => (
                  <li key={d} className="grid grid-cols-[3rem_1fr_2rem] items-center gap-3 text-sm">
                    <span className="text-fg-muted">
                      <span aria-hidden="true">{WEEKDAYS[d]}</span>
                      <VisuallyHidden>{WEEKDAYS_LONG[d]}</VisuallyHidden>
                    </span>
                    <span className="h-2.5 rounded-full bg-sunken" aria-hidden="true">
                      <span
                        className="u-bar-x block h-full rounded-full"
                        style={{ ...rise(d), width: `${n === 0 ? 0 : Math.max(5, (n / maxDay) * 100)}%`, background: d === topDay && n > 0 ? 'var(--accent)' : 'var(--ai)' }}
                      />
                    </span>
                    <span className="text-right text-fg-muted tabular-nums">{n}</span>
                  </li>
                ))}
              </ul>
            </figure>
          </div>
        </>
      );
    }
    case 'bookends':
      return (
        <>
          <Headline kicker={label}>Where it began, and where it ended.</Headline>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {slide.first && <EntryLink entry={slide.first} caption="First entry" i={2} />}
            {slide.last && <EntryLink entry={slide.last} caption="Latest entry" i={3} />}
          </div>
        </>
      );
    case 'people':
      return (
        <>
          <Headline kicker={label}>{slide.top[0]?.name} was on your mind.</Headline>
          <div className="mt-8">
            <BarRows rows={slide.top.slice(0, 6).map((p) => ({ key: p.name, label: p.name, n: p.count, color: 'var(--ai)' }))} color="var(--ai)" />
          </div>
        </>
      );
    case 'highlight':
      return (
        <>
          <Headline kicker={label}>One to remember.</Headline>
          <p className="u-rise mt-4 max-w-prose text-fg-muted" style={rise(2)}>
            {slide.reason}
          </p>
          <div className="mt-6">
            <EntryLink entry={slide.entry} caption="Highlight" i={3} />
          </div>
        </>
      );
  }
}

function PersonaBody({ persona }: { persona: NonNullable<Unwrapped['persona']> }) {
  return (
    <>
      <p className="u-rise text-sm font-medium tracking-wide text-ai uppercase" style={rise(0)}>
        Your persona
      </p>
      <div className="u-rise mt-4 max-w-xl rounded-card border border-ai/30 bg-surface px-6 py-7 shadow-2 sm:px-8 sm:py-9" style={rise(1)}>
        <h2 className="type-heading text-4xl leading-tight text-fg sm:text-5xl">{persona.name}</h2>
        <p className="mt-4 font-prose text-reading text-fg-muted">{persona.description}</p>
        <ul className="mt-6 flex flex-wrap gap-2" aria-label="Traits">
          {persona.traits.map((t) => (
            <li key={t} className="rounded-full border border-ai/30 bg-ai-soft px-3 py-1 text-sm text-ai">
              {t}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs text-fg-faint">Built only from counts and times in your journal, never from what you wrote.</p>
      </div>
    </>
  );
}

// ───────────────────────── the story ─────────────────────────

function Story({ data, teen, onClose }: { data: Unwrapped; teen: boolean; onClose: () => void }) {
  const story = useMemo(() => buildStory(data, { teen }), [data, teen]);
  const [nav, dispatch] = useReducer(navReduce, { index: 0, count: story.length });
  const region = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const index = Math.min(nav.index, Math.max(0, story.length - 1));
  const current = story[index] as StorySlide;
  const last = index === story.length - 1;

  useEffect(() => {
    region.current?.focus();
  }, []);
  useEffect(() => {
    if (last && story.length > 1) play('celebrate');
  }, [last, story.length]);

  const go = (a: Parameters<typeof navReduce>[1]) => dispatch(a);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      // Escape closes the story, but not when it was meant for an open picker or another dialog.
      if (e.key === 'Escape') {
        if (e.defaultPrevented || t?.closest('select,input,textarea,[role="dialog"]:not(.unwrapped-stage)')) return;
        return onClose();
      }
      // Leave the period pickers and buttons alone, except for the arrows that move the story.
      if (t?.closest('select,input,textarea')) return;
      const a = keyToNav(e.key);
      if (!a) return;
      if (t?.closest('a,button') && e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      go(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onPointerDown = (e: PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!start.current) return;
    const a = swipeToNav(e.clientX - start.current.x, e.clientY - start.current.y);
    start.current = null;
    if (a) go(a);
  };

  return (
    <div
      ref={region}
      tabIndex={0}
      role="region"
      aria-roledescription="carousel"
      aria-label={`${data.label} Unwrapped`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      className="flex min-h-0 flex-1 flex-col outline-none"
      style={{ touchAction: 'pan-y' }}
    >
      <div className="flex min-h-0 flex-1 items-center overflow-y-auto px-6 py-8 sm:px-12">
        <div
          key={current.id}
          role="group"
          aria-roledescription="slide"
          aria-label={`${index + 1} of ${story.length}: ${current.label}`}
          className="unwrapped-slide mx-auto w-full max-w-3xl"
        >
          {current.kind === 'persona' ? <PersonaBody persona={current.persona} /> : <SlideBody slide={current.slide} label={current.label} />}
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {`Slide ${index + 1} of ${story.length}: ${current.label}`}
      </p>

      <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-8">
        <Button variant="ghost" size="sm" aria-label="Previous slide" disabled={index === 0} onClick={() => go('prev')} icon={<ChevronLeft className="size-4" aria-hidden="true" />}>
          <span className="max-sm:sr-only">Back</span>
        </Button>
        <ol className="flex items-center gap-1" aria-label="Slides">
          {story.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => go({ to: i })}
                aria-label={`Slide ${i + 1} of ${story.length}: ${s.label}`}
                aria-current={i === index ? 'step' : undefined}
                className="group grid size-8 place-items-center rounded-full max-sm:size-6"
              >
                <span
                  aria-hidden="true"
                  className={`block h-2 rounded-full transition-all ${i === index ? 'w-6 bg-accent' : i < index ? 'w-2 bg-ai/60' : 'w-2 bg-line-strong'} group-hover:bg-accent`}
                />
              </button>
            </li>
          ))}
        </ol>
        <Button
          variant={last ? 'secondary' : 'ghost'}
          size="sm"
          aria-label={last ? 'Done' : 'Next slide'}
          onClick={() => (last ? onClose() : go('next'))}
          icon={last ? undefined : <ChevronRight className="size-4" aria-hidden="true" />}
          className="flex-row-reverse"
        >
          <span className={last ? '' : 'max-sm:sr-only'}>{last ? 'Done' : 'Next'}</span>
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────── page ─────────────────────────

export default function UnwrappedPage() {
  const tz = useTimezone();
  const { profile } = useProfile();
  const voice = useVoice();
  const today = localDate(new Date(), tz);
  const [params, setParams] = useSearchParams();
  const period = params.get('period') === 'year' ? 'year' : 'month';
  const options = period === 'year' ? yearOptions(today) : monthOptions(today);
  const requested = params.get('at');
  const at = requested && options.includes(requested) ? requested : period === 'year' ? String(Number(today.slice(0, 4)) - 1) : defaultMonth(today);
  const query = useUnwrapped(period, at, tz);
  const teen = profile?.mode === 'teen';
  const navigate = useNavigate();
  const closeTo = '/app/insights';

  const set = (next: { period?: string; at?: string }) => {
    const p = next.period ?? period;
    const a = next.at ?? (p === 'year' ? String(Number(today.slice(0, 4)) - 1) : defaultMonth(today));
    setParams({ period: p, at: a }, { replace: true });
  };

  const data = query.data;
  const body = query.isPending ? (
    <div className="grid flex-1 place-items-center" role="status">
      <p className="text-fg-muted">Putting your {period} together…</p>
    </div>
  ) : query.isError ? (
    <div className="grid flex-1 place-items-center px-6">
      <InlineError
        message={query.error instanceof ApiRequestError && query.error.status === 404 ? 'Unwrapped isn’t available yet.' : 'Couldn’t put your Unwrapped together.'}
        onRetry={() => void query.refetch()}
      />
    </div>
  ) : !data || isNotEnough(data) ? (
    <div className="grid flex-1 place-items-center px-6 py-10">
      <div className="max-w-md text-center">
        <h2 className="type-heading text-3xl text-fg">{voice.unwrappedNotEnoughTitle}</h2>
        <p className="mt-3 text-fg-muted">
          Unwrapped needs at least {plural(data?.minEntries ?? 0, 'entry', 'entries')} in {data?.label ?? 'this period'}, and there aren’t quite enough yet. Try another {period}, or keep writing and come back.
        </p>
        <Link to="/app/today" className={buttonClasses('primary', 'md', 'mt-6')}>
          Write today’s entry
        </Link>
      </div>
    </div>
  ) : (
    <Story key={`${period}-${at}`} data={data} teen={teen} onClose={() => navigate(closeTo)} />
  );

  const stage = useRef<HTMLDivElement>(null);
  // A real modal: the app behind it is inert (no tab stops, hidden from screen readers), focus moves
  // in, and goes back to where it was when the story closes.
  useEffect(() => {
    const root = document.getElementById('root');
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root?.setAttribute('inert', '');
    stage.current?.focus({ preventScroll: true });
    return () => {
      root?.removeAttribute('inert');
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div
      ref={stage}
      role="dialog"
      aria-modal="true"
      aria-labelledby="unwrapped-title"
      tabIndex={-1}
      className="unwrapped-stage fixed inset-0 z-50 flex flex-col outline-none">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 sm:px-8">
        <Link to={closeTo} className={buttonClasses('ghost', 'sm', '-ml-2')} aria-label="Close Unwrapped">
          <ArrowLeft className="size-4 sm:hidden" aria-hidden="true" />
          <X className="size-4 max-sm:hidden" aria-hidden="true" />
          <span className="max-sm:sr-only">Close</span>
        </Link>
        <h1 id="unwrapped-title" className="type-heading min-w-[11rem] flex-1 truncate text-lg text-fg">
          Unwrapped <span className="text-fg-muted">· {period === 'year' ? at : monthName(at)}</span>
        </h1>
        <div className="flex items-center gap-2">
          <Select
            label="Period"
            value={period}
            onChange={(e) => set({ period: e.target.value })}
            options={[
              { value: 'month', label: 'Month' },
              { value: 'year', label: 'Year' },
            ]}
            containerClassName="[&>label]:sr-only"
          />
          <Select
            label={period === 'year' ? 'Year' : 'Month'}
            value={at}
            onChange={(e) => set({ at: e.target.value })}
            options={options.map((o) => ({ value: o, label: period === 'year' ? o : monthName(o) }))}
            containerClassName="[&>label]:sr-only"
          />
        </div>
      </header>
      {body}
    </div>,
    document.body,
  );
}
