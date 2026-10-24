import { Suspense, useEffect, useRef, useState } from 'react';
import { useProfile, useSession, useTimezone } from '@/lib/session';
import { useWorldManifest } from '@/worlds';
import { useCompanionState } from '../journal-core/queries-v3';
import {
  REACTION_MS,
  achievedKeys,
  isSaveLanding,
  newMilestones,
  pickReaction,
  readSeen,
  writeSeen,
  type CompanionReaction,
} from './companionLogic';

/**
 * The world's companion, small and beside the greeting. It reacts briefly to a save and to a
 * newly reached milestone, then settles. It does nothing when clicked and never covers the
 * editor. Motion lives in the companion itself and is static under reduced motion.
 */
export function TodayCompanion({ syncStatus }: { syncStatus: string | null | undefined }) {
  const { profile } = useProfile();
  const { userId } = useSession();
  const tz = useTimezone();
  const manifest = useWorldManifest();
  const data = useCompanionState(tz);
  const [reaction, setReaction] = useState<CompanionReaction>('idle');
  const timer = useRef<number | undefined>(undefined);

  const react = (next: 'saved' | 'celebrate') => {
    setReaction((cur) => pickReaction(cur, next));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setReaction('idle'), REACTION_MS[next]);
  };

  const prev = useRef(syncStatus);
  useEffect(() => {
    const landed = isSaveLanding(prev.current, syncStatus);
    prev.current = syncStatus;
    if (!landed) return;
    const t = window.setTimeout(() => react('saved'), 0);
    return () => window.clearTimeout(t);
  }, [syncStatus]);

  const milestones = data.data?.milestones;
  useEffect(() => {
    if (!userId || !milestones) return;
    const fresh = newMilestones(milestones, readSeen(userId)).length > 0;
    writeSeen(userId, achievedKeys(milestones));
    if (!fresh) return;
    const t = window.setTimeout(() => react('celebrate'), 0);
    return () => window.clearTimeout(t);
  }, [userId, milestones]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const Companion = manifest.Companion;
  return (
    <div data-testid="today-companion" data-state={reaction} className="shrink-0">
      <Suspense fallback={null}>
        <Companion name={profile?.companionName?.trim() ?? ''} placement="today" state={reaction} />
      </Suspense>
    </div>
  );
}
