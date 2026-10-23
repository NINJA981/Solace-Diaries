import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Maximize2, Minimize2, RotateCcw, Trash, ImagePlus } from 'lucide-react';
import { LIMITS, countWords, type Entry } from '@solace/shared';
import { IconButton, toast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { feedback } from '@/lib/feedback';
import { useVoice } from '@/lib/voice';
import { formatLongDay, plural } from '../format';
import { isEnriching, useRetryEnrichment } from '../queries';
import { ConflictSheet } from './ConflictSheet';
import { MoodPicker } from './MoodPicker';
import { Photos, usePhotoUploads } from './Photos';
import { SaveStatus } from './SaveStatus';
import { TagEditor } from './TagEditor';
import '../journal.css';
import type { EntrySync, Mood } from './syncEngine';
import { useEngineSnapshot } from './useEntryEditor';

type Props = {
  engine: EntrySync;
  server?: Entry;
  /** 'label' shows the date; 'picker' lets the user change entryDate. */
  dateMode: 'label' | 'picker';
  today: string;
  placeholder?: string;
  autoFocus?: boolean;
  onDelete?: () => void;
  /** Called when the user discards a draft whose entry was deleted elsewhere. */
  onGone?: () => void;
  /** Extra page-level actions shown in the toolbar (e.g. Today's "New entry"). */
  actions?: React.ReactNode;
};

const supportsPopover = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;
const NO_ATTACHMENTS: Entry['attachments'] = [];
const supportsFieldSizing = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content');

/** JS fallback for browsers without `field-sizing: content`. */
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || supportsFieldSizing) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}

function imageFiles(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return [];
  const out: File[] = [];
  for (const item of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const file = item instanceof File ? item : item.kind === 'file' ? item.getAsFile() : null;
    if (file && (file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name))) out.push(file);
  }
  return out;
}

/**
 * The writing surface. No Save button: every keystroke goes to the autosave engine, which
 * keeps a device draft and syncs to the server in the background.
 */
export function Editor({ engine, server, dateMode, today, placeholder, autoFocus, onDelete, onGone, actions }: Props) {
  const snapshot = useEngineSnapshot(engine)!;
  const { fields } = snapshot;
  const [focusMode, setFocusMode] = useState(false);
  // The sheet opens for each new conflict; closing it only hides that one (Review reopens).
  const [dismissedConflict, setDismissedConflict] = useState<object | null>(null);
  const [dragging, setDragging] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const titleId = useId();
  const bodyId = useId();
  const dateId = useId();
  const retry = useRetryEnrichment(engine.id);
  const voice = useVoice();

  const attachments = server?.attachments ?? NO_ATTACHMENTS;
  const photos = usePhotoUploads(engine, attachments.length);
  const words = countWords(fields.body);

  useAutoGrow(bodyRef, fields.body);

  // Save-status cues (sound and haptics only when the person turned them on): an error that needs
  // attention, and words safely back on the server after being offline or retrying.
  const status = snapshot.status;
  const lastStatus = useRef(status);
  useEffect(() => {
    const prev = lastStatus.current;
    lastStatus.current = status;
    if (prev === status) return;
    if (status === 'failed' || status === 'conflict') feedback('error');
    else if (status === 'saved' && (prev === 'offline' || prev === 'retrying')) feedback('save');
  }, [status]);

  const conflictOpen = !!snapshot.conflict && dismissedConflict !== snapshot.conflict;
  const setConflictOpen = (open: boolean) => setDismissedConflict(open ? null : snapshot.conflict);

  // Ctrl/⌘+S forces a save; Esc leaves focus mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        // An explicit save gets the save cue (sound/haptics, when on) once it has landed.
        void engine.flush().then(() => {
          if (engine.getSnapshot().status === 'saved') feedback('save');
        });
      } else if (e.key === 'Escape' && focusMode && !conflictOpen) {
        setFocusMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, focusMode, conflictOpen]);

  useEffect(() => {
    if (autoFocus && !fields.body) bodyRef.current?.focus({ preventScroll: true });
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus mode: lift this same element into the top layer (Popover API) so it covers the
  // whole app without remounting the textarea (caret and selection survive). Browsers
  // without popover fall back to position: fixed.
  useEffect(() => {
    if (!focusMode) return;
    const el = rootRef.current;
    let lifted = false;
    if (el && supportsPopover) {
      try {
        el.setAttribute('popover', 'manual');
        el.showPopover();
        lifted = true;
      } catch {
        el.removeAttribute('popover');
      }
    }
    bodyRef.current?.focus({ preventScroll: true });
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
      if (lifted && el) {
        try {
          el.hidePopover();
        } catch {
          /* already hidden */
        }
        el.removeAttribute('popover');
      }
    };
  }, [focusMode]);

  const flush = useCallback(() => void engine.flush(), [engine]);
  const onMood = useCallback((mood: Mood | null) => engine.edit({ mood }), [engine]);
  const onTags = useCallback((tags: string[]) => engine.edit({ tags }), [engine]);
  const { addFiles } = photos;
  const onAddPhotos = useCallback((f: File[]) => void addFiles(f), [addFiles]);

  const onPaste = (e: React.ClipboardEvent) => {
    const files = imageFiles(e.clipboardData?.files);
    if (files.length) {
      e.preventDefault();
      void photos.addFiles(files);
    }
  };

  const enriching = snapshot.version !== null && isEnriching(server?.enrichmentStatus);
  const nearLimit = fields.body.length > LIMITS.bodyMax * 0.9;

  return (
    <div
      ref={rootRef}
      className={clsx(
        'relative',
        focusMode &&
          'fixed inset-0 z-50 m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto border-0 bg-canvas px-4 pt-6 pb-24 text-fg sm:px-8 sm:pt-12',
      )}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        dragDepth.current = 0;
        setDragging(false);
        const files = imageFiles(e.dataTransfer.files);
        if (files.length) {
          e.preventDefault();
          void photos.addFiles(files);
        }
      }}
    >
      <div className={clsx('mx-auto w-full', focusMode ? 'max-w-[68ch]' : '')}>
        {/* Toolbar: date on the left, quiet state + actions on the right. */}
        <div className="mb-4 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1">
          {dateMode === 'picker' && !focusMode ? (
            <div className="flex items-center gap-2">
              <label htmlFor={dateId} className="sr-only">
                Entry date
              </label>
              <input
                id={dateId}
                type="date"
                value={fields.entryDate}
                max={today}
                onChange={(e) => e.target.value && engine.edit({ entryDate: e.target.value })}
                className="-ml-2 h-11 rounded-control border border-transparent bg-transparent px-2 text-sm text-fg-muted transition-colors hover:border-line hover:text-fg focus-visible:border-line-strong sm:h-9"
              />
            </div>
          ) : (
            <p className="text-sm text-fg-muted">{formatLongDay(fields.entryDate)}</p>
          )}
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <SaveStatus snapshot={snapshot} onResolve={() => setConflictOpen(true)} />
            {!focusMode && <span className="hidden text-xs text-fg-faint tabular-nums sm:inline">{plural(words, 'word')}</span>}
            {!focusMode && actions}
            <IconButton
              label={focusMode ? 'Leave focus mode' : 'Focus mode'}
              icon={focusMode ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              onClick={() => setFocusMode((f) => !f)}
              aria-pressed={focusMode}
            />
            {onDelete && !focusMode && (
              <IconButton label="Delete entry" icon={<Trash className="size-4" />} onClick={onDelete} />
            )}
          </div>
        </div>

        <label htmlFor={titleId} className="sr-only">
          Title
        </label>
        <input
          id={titleId}
          value={fields.title}
          maxLength={LIMITS.titleMax}
          placeholder="Untitled"
          autoComplete="off"
          onChange={(e) => engine.edit({ title: e.target.value })}
          style={dateMode === 'picker' ? { viewTransitionName: 'entry-title' } : undefined}
          onBlur={flush}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              bodyRef.current?.focus();
            }
          }}
          className="journal-writing journal-caret -ml-3.5 w-[calc(100%+0.875rem)] border-l-2 border-transparent bg-transparent pl-3 type-heading text-2xl leading-tight text-fg placeholder:text-fg-faint/70 focus-visible:border-accent/70 focus-visible:outline-none sm:text-3xl"
        />

        <label htmlFor={bodyId} className="sr-only">
          Entry
        </label>
        <textarea
          id={bodyId}
          ref={bodyRef}
          value={fields.body}
          maxLength={LIMITS.bodyMax}
          placeholder={placeholder ?? voice.entryPlaceholder}
          onChange={(e) => engine.edit({ body: e.target.value })}
          onBlur={flush}
          onPaste={onPaste}
          rows={8}
          spellCheck
          className={clsx(
            'journal-writing journal-autogrow journal-caret prose-journal mt-4 -ml-3.5 block w-[calc(100%+0.875rem)] max-w-none resize-none overflow-hidden border-l-2 border-transparent bg-transparent pl-3 text-fg placeholder:text-fg-faint/70 focus-visible:border-accent/70 focus-visible:outline-none',
            // Room for a few paragraphs; field-sizing grows it from there. Not a viewport fraction,
            // so the mood/tags/photos row stays within reach on Today.
            focusMode ? 'min-h-[70vh]' : dateMode === 'picker' ? 'min-h-[5lh]' : 'min-h-[4lh] sm:min-h-[7lh]',
          )}
        />
        {nearLimit && (
          <p className="mt-2 text-xs text-fg-faint">
            {(LIMITS.bodyMax - fields.body.length).toLocaleString()} characters left in this entry.
          </p>
        )}
        {focusMode && (
          <p className="fixed right-4 bottom-4 text-xs text-fg-faint tabular-nums">
            {plural(words, 'word')} <span className="sr-only">. Press Escape to leave focus mode.</span>
          </p>
        )}
      </div>

      {!focusMode && (
        <div className="mt-8 space-y-8">
          {enriching && (
            <p className="flex items-center gap-2 text-sm text-ai" role="status">
              <span className="size-1.5 animate-pulse rounded-full bg-ai motion-reduce:animate-none" aria-hidden="true" />
              {voice.readingEntry}
            </p>
          )}
          {server?.enrichmentStatus === 'ready' && server.summary && (
            <aside aria-label="Solace’s note" className="border-l-2 border-ai/60 pl-4">
              <p className="text-xs font-medium text-ai">{voice.noteLabel}</p>
              <p className="mt-1 font-prose text-base leading-relaxed text-fg-muted italic">{server.summary}</p>
            </aside>
          )}
          {server?.enrichmentStatus === 'failed' && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
              Solace couldn’t read this entry, so there’s no mood suggestion or note yet.
              <button
                type="button"
                disabled={retry.isPending}
                onClick={() =>
                  retry.mutate(undefined, { onError: (err) => toast(errorMessage(err), { tone: 'danger' }) })
                }
                className="inline-flex min-h-11 items-center gap-1.5 font-medium text-ai underline underline-offset-2 sm:min-h-0"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Try again
              </button>
            </p>
          )}

          <div className="grid gap-5 border-t border-line pt-6">
            <MoodPicker mood={fields.mood} source={fields.moodSource} onChange={onMood} />
            {/* Tags and photos stay a quiet row until used; photos open into a grid once there are some. */}
            <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
              <TagEditor tags={fields.tags} onChange={onTags} />
              <Photos
                entryId={engine.id}
                attachments={attachments}
                uploads={photos.uploads}
                onAdd={onAddPhotos}
                onDismissUpload={photos.dismiss}
              />
            </div>
          </div>
        </div>
      )}

      {dragging && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[55] grid place-items-center bg-canvas/70 backdrop-blur-sm"
        >
          <div className="flex flex-col items-center gap-2 rounded-sheet border border-dashed border-accent px-10 py-8 text-accent">
            <ImagePlus className="size-6" />
            <span className="text-sm font-medium">Drop photos to add them</span>
          </div>
        </div>
      )}

      {snapshot.conflict && (
        <ConflictSheet
          open={conflictOpen}
          onOpenChange={setConflictOpen}
          conflict={snapshot.conflict}
          mine={fields}
          onResolve={async (choice) => {
            const wasDeleted = snapshot.conflict?.kind === 'deleted';
            await engine.resolveConflict(choice);
            if (wasDeleted && choice === 'theirs') onGone?.();
          }}
        />
      )}
    </div>
  );
}

