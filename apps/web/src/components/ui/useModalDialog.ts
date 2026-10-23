import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useWorldMotion } from '@/lib/motion';

/** Longest an exit may take before the dialog closes anyway (e.g. animations not loaded yet). */
const EXIT_TIMEOUT = 450;

/**
 * Native modal <dialog> plumbing shared by Dialog and the command palette, with motion:
 * showModal() on open; on close the content animates out first, then close() runs and focus
 * returns to whatever opened it (focus can't land on the inert page while the modal is open).
 *
 *   const { present, motionProps, closeNow } = useModalDialog(open, ref);
 *   <m.dialog ref={ref} {...motionProps}>{present && …}</m.dialog>
 */
export function useModalDialog(open: boolean, ref: RefObject<HTMLDialogElement | null>) {
  const { presets, spring, reduced, fade } = useWorldMotion();
  const returnTo = useRef<HTMLElement | null>(null);
  const timer = useRef(0);
  const openRef = useRef(open);
  // Content stays mounted while the exit plays (state adjusted during render, not in an effect).
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  // Mounted already open (e.g. a conflict sheet): still animate in.
  const [initial] = useState<'hidden' | false>(() => (open ? 'hidden' : false));

  const finishClose = useCallback(() => {
    window.clearTimeout(timer.current);
    const dialog = ref.current;
    if (openRef.current) return;
    if (dialog?.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    dialog?.removeAttribute('data-closing');
    setPresent(false);
    const target = returnTo.current;
    returnTo.current = null;
    if (target?.isConnected) target.focus();
  }, [ref]);

  useEffect(() => {
    openRef.current = open;
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      window.clearTimeout(timer.current);
      dialog.removeAttribute('data-closing');
      if (!dialog.open) {
        returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      }
    } else if (dialog.open) {
      dialog.setAttribute('data-closing', '');
      timer.current = window.setTimeout(finishClose, EXIT_TIMEOUT);
    }
  }, [open, ref, finishClose]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const hidden = reduced ? { opacity: 0 } : { opacity: 0, y: presets.enterDistance, scale: presets.enterScale };
  const motionProps = {
    initial,
    animate: open ? 'shown' : 'hidden',
    variants: {
      shown: { opacity: 1, y: 0, scale: 1, transition: reduced ? fade : spring },
      hidden: { ...hidden, transition: { duration: reduced ? 0.12 : 0.14, ease: 'easeIn' as const } },
    },
    onAnimationComplete: (definition: unknown) => {
      if (definition === 'hidden' && !openRef.current) finishClose();
    },
  };
  /**
   * Closes at once, without the exit, for actions that move on (navigation): the next page can
   * only take focus once the modal is gone, and focus shouldn't go back to the opener.
   */
  const closeNow = useCallback(() => {
    openRef.current = false;
    returnTo.current = null;
    finishClose();
  }, [finishClose]);
  return { present, motionProps, closeNow };
}
