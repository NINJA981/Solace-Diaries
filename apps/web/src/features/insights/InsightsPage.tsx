import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, BookOpen, Sparkles, Telescope } from 'lucide-react';
import { localDate } from '@solace/shared';
import { EmptyState, buttonClasses } from '@/components/ui';
import { useTimezone } from '@/lib/session';
import { useVoice } from '@/lib/voice';
import { InlineError } from '../journal-core/EntryCard';
import { useGraph, useStats } from '../journal-core/queries';
import { Threads } from '../intentions/Threads';
import { UnwrappedCard } from '../unwrapped/UnwrappedCard';
import { LamplightSkyHeader } from './skins/lamplightSkyHeader';
import { GrowthNote } from './GrowthNote';
import { Patterns } from './Patterns';
import { Constellation } from './Constellation';
import { useConstellationSkin } from './useConstellationSkin';
import { Memories } from './Memories';
import { MoodChart } from './MoodChart';
import { StatRow, StatRowSkeleton } from './StatRow';
import { WeeklyLetter } from './WeeklyLetter';
import { HeatmapLegend, YearHeatmap } from './YearHeatmap';

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-20">
      <h2 id={id} className="type-heading text-2xl text-fg">
        {title}
      </h2>
      {intro && <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-fg-muted">{intro}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function InsightsPage() {
  const tz = useTimezone();
  const today = localDate(new Date(), tz);
  const stats = useStats(tz);
  const graph = useGraph();
  const voice = useVoice();
  const skin = useConstellationSkin();
  const s = stats.data;
  const hasMoods = !!s?.moodTrend.some((w) => w.avgScore !== null);
  // A brand-new journal gets one invitation, not a stack of empty sections.
  const showDetail = !stats.isPending && !(s && s.totalEntries === 0);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-20 sm:px-8 sm:pt-10">
      <LamplightSkyHeader>
        <h1 className="type-heading text-3xl text-fg sm:text-4xl">Insights</h1>
        <p className="mt-2 max-w-prose text-fg-muted">What your writing looks like over time, and what Solace has picked up along the way.</p>
      </LamplightSkyHeader>

      <div className="mt-8 space-y-14">
        {showDetail && <UnwrappedCard />}
        {stats.isPending ? (
          <StatRowSkeleton />
        ) : stats.isError ? (
          <InlineError message="Couldn’t load your insights." onRetry={() => void stats.refetch()} />
        ) : s && s.totalEntries === 0 ? (
          <EmptyState
            icon={<Telescope />}
            title={voice.insightsEmptyTitle}
            description={voice.insightsEmptyBody}
            action={
              <Link to="/app/today" className={buttonClasses('primary')}>
                Write today’s entry
              </Link>
            }
          />
        ) : s ? (
          <>
            <StatRow stats={s} />

            <Section id="year" title="Your year" intro="Each square is a day. Color shows the mood of that day’s entries.">
              <YearHeatmap days={s.days} today={s.today} />
              <div className="mt-2">
                <HeatmapLegend />
              </div>
            </Section>

            <Section
              id="mood"
              title="Mood over time"
              intro={
                hasMoods
                  ? 'The line is your average mood each week. The columns show how many moods you logged, from heavy to bright.'
                  : undefined
              }
            >
              {hasMoods ? (
                <MoodChart trend={s.moodTrend} />
              ) : (
                <p className="max-w-prose text-sm text-fg-muted">
                  Pick a mood when you write, or let Solace sense one, and you’ll see how your weeks feel here.
                </p>
              )}
            </Section>
          </>
        ) : null}

        {showDetail && (
          <>
            <WeeklyLetter tz={tz} today={today} days={s?.days ?? []} />

            <Section id="patterns" title="Mood patterns" intro={voice.patternsIntro}>
              <Patterns />
            </Section>

            <Section id="growth" title="How you’ve grown" intro={voice.growthIntro}>
              <GrowthNote />
            </Section>

            <Section id="threads" title="Threads" intro={voice.threadsIntro}>
              <Threads />
            </Section>

            <Section id="chapters" title="Life chapters" intro="The seasons Solace sees in your writing, on a timeline you can scroll and zoom.">
              <Link
                to="/app/insights/chapters"
                className="group inline-flex min-h-11 items-center gap-2 rounded-control border border-line-strong bg-raised px-4 text-sm font-medium text-fg transition-colors hover:border-fg-faint hover:bg-sunken"
              >
                <BookOpen className="size-4 text-ai" aria-hidden="true" />
                Open your chapters
                <ArrowRight className="size-4 text-fg-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </Section>

            <Section
              id="constellation"
              title="Memory constellation"
              intro="The people, places, goals and feelings that keep coming up in your entries, and how they connect."
            >
              {graph.isPending ? (
                <div aria-hidden="true" className="h-72 animate-pulse rounded-card bg-sunken" />
              ) : graph.isError ? (
                <InlineError message="Couldn’t load the constellation." onRetry={() => void graph.refetch()} />
              ) : graph.data.nodes.length < 3 ? (
                <div className="rounded-card border border-line bg-sunken">
                  <EmptyState
                    icon={<Sparkles />}
                    title={voice.skyEmptyTitle}
                    description={voice.skyEmptyBody}
                  />
                </div>
              ) : (
                <Constellation graph={graph.data} skin={skin} />
              )}
            </Section>

            <Section
              id="memories"
              title="What Solace remembers"
              intro="Solace keeps short notes from your entries so its answers know your context. You’re in control: edit anything that’s off, archive what no longer fits, or delete it."
            >
              <Memories />
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
