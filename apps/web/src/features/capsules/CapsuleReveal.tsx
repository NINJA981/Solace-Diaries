import { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { m, useReducedMotion } from 'motion/react';
import type { Capsule } from '@solace/shared';
import { Button, Dialog } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { play } from '@/lib/feedback';
import { Motion, enterFrom, useWorldMotion } from '@/lib/motion';
import { useDeviceWorld } from '@/lib/theme';
import { useVoice } from '@/lib/voice';
import { useOpenCapsule } from '../journal-core/queries-v3';
import { formatUnlock } from './capsuleLogic';
import './capsules.css';

/** How long the seal gets to do its thing before the letter shows (skipped under reduced motion). */
const CEREMONY_MS = 1500;

type Props = {
  /** The capsule to open (ready) or re-read (opened, body present). Null closes. */
  capsule: Capsule | null;
  tz: string;
  onClose: () => void;
};

/**
 * Opening a ready capsule: a short, world-specific unsealing, then the letter in prose.
 * The request runs while the seal plays; announcements go through a live region.
 */
export function CapsuleReveal({ capsule, tz, onClose }: Props) {
  const open = useOpenCapsule();
  const world = useDeviceWorld();
  const voice = useVoice();
  const { presets, spring, fade } = useWorldMotion();
  const reduced = useReducedMotion() ?? false;
  const [ceremonyDone, setCeremonyDone] = useState<string | null>(null);
  const letterRef = useRef<HTMLDivElement>(null);
  const startedFor = useRef<string | null>(null);

  const id = capsule?.id ?? null;
  const needsOpen = !!capsule && capsule.status !== 'opened' && capsule.body === null;
  const letter = open.data?.id === id ? open.data : capsule?.body != null ? capsule : null;

  // Start opening once per capsule (the guard also survives StrictMode's double effect).
  useEffect(() => {
    if (!id) {
      startedFor.current = null;
      open.reset();
      return;
    }
    if (startedFor.current === id) return;
    startedFor.current = id;
    if (needsOpen) open.mutate(id);
    // keyed by id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // The ceremony's minimum length. Reduced motion skips straight to the letter.
  useEffect(() => {
    if (!id || !needsOpen || reduced) return;
    const t = window.setTimeout(() => setCeremonyDone(id), CEREMONY_MS);
    return () => window.clearTimeout(t);
  }, [id, needsOpen, reduced]);
  const timerDone = !needsOpen || reduced || ceremonyDone === id;

  const showLetter = !!letter && timerDone;
  const wasShown = useRef(false);
  useEffect(() => {
    if (showLetter && !wasShown.current && needsOpen) play('celebrate');
    if (showLetter) letterRef.current?.focus();
    wasShown.current = showLetter;
  }, [showLetter, needsOpen]);

  const error = open.isError ? errorMessage(open.error) : null;

  return (
    <Dialog
      open={!!capsule}
      onOpenChange={(o) => !o && onClose()}
      title={showLetter && letter ? letter.title : error ? 'Couldn’t open it yet' : 'Opening your letter'}
      description={showLetter && letter ? `Sealed for ${formatUnlock(letter.unlockAt, tz)}` : undefined}
      className="sm:max-w-xl"
      footer={
        error ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => id && open.mutate(id)}>Try again</Button>
          </>
        ) : showLetter ? (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        ) : undefined
      }
    >
      <Motion>
        <div role="status" aria-live="polite" className="sr-only">
          {error ?? (showLetter ? `${voice.capsuleRevealTitle}. ${letter?.title ?? ''}` : 'Opening your letter…')}
        </div>
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : showLetter && letter ? (
          <m.div
            ref={letterRef}
            tabIndex={-1}
            initial={enterFrom(presets, reduced, presets.enterDistance * 0.5)}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={reduced ? fade : spring}
            className="max-h-[60vh] overflow-y-auto outline-none"
            data-testid="capsule-letter"
          >
            <p className="mb-3 text-xs text-fg-faint">{voice.capsuleRevealTitle}</p>
            <div className="prose-journal whitespace-pre-wrap text-fg">{letter.body}</div>
          </m.div>
        ) : (
          <div className="py-6" data-testid="capsule-seal">
            <span className="capsule-seal" data-world={world} aria-hidden="true">
              <Lock />
            </span>
          </div>
        )}
      </Motion>
    </Dialog>
  );
}
