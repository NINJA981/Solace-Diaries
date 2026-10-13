import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, LoaderCircle, X } from 'lucide-react';
import { LIMITS, type Attachment, type Entry } from '@solace/shared';
import { api, errorMessage } from '@/lib/api';
import { ConfirmDialog, Dialog, toast } from '@/components/ui';
import { qk, useDeleteAttachment } from '../queries';
import type { EntrySync } from './syncEngine';

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MB = 1024 * 1024;

type Upload = { key: string; name: string; preview: string; error?: string };

/** Client-side checks before upload. Returns an error sentence or null. */
export function checkPhoto(file: File, slotsLeft: number): string | null {
  if (slotsLeft <= 0) return `An entry can hold up to ${LIMITS.attachmentsPerEntry} photos.`;
  const type = file.type || (/\.(heic|heif)$/i.test(file.name) ? 'image/heic' : '');
  if (!PHOTO_TYPES.includes(type)) return `${file.name} isn’t a supported photo. Use JPEG, PNG, WebP or HEIC.`;
  if (file.size > LIMITS.attachmentBytes) return `${file.name} is larger than ${LIMITS.attachmentBytes / MB} MB.`;
  return null;
}

/**
 * Upload pipeline: make sure the entry exists server-side (sync first), then upload one
 * photo per request. The API client doesn't expose byte progress, so each tile shows an
 * indeterminate spinner over a local preview.
 */
export function usePhotoUploads(engine: EntrySync | null, existing: number) {
  const qc = useQueryClient();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const inFlight = useRef(0);
  const controllers = useRef(new Set<AbortController>());

  useEffect(
    () => () => {
      for (const c of controllers.current) c.abort();
    },
    [],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!engine || !files.length) return;
      let slots = LIMITS.attachmentsPerEntry - existing - inFlight.current;
      const accepted: File[] = [];
      for (const f of files) {
        const err = checkPhoto(f, slots);
        if (err) {
          toast(err, { tone: 'danger' });
          if (slots <= 0) break;
          continue;
        }
        accepted.push(f);
        slots--;
      }
      if (!accepted.length) return;
      inFlight.current += accepted.length;
      const items = accepted.map((f) => ({ key: crypto.randomUUID(), name: f.name, preview: URL.createObjectURL(f), file: f }));
      setUploads((u) => [...u, ...items.map(({ file: _f, ...rest }) => rest)]);

      const ok = await engine.ensureCreated();
      if (!ok) {
        toast('Photos need a connection. Your words are safe on this device.', { tone: 'danger' });
        inFlight.current -= items.length;
        setUploads((u) => u.filter((x) => !items.some((i) => i.key === x.key)));
        items.forEach((i) => URL.revokeObjectURL(i.preview));
        return;
      }
      const id = engine.id;
      await Promise.all(
        items.map(async (item) => {
          const ctrl = new AbortController();
          controllers.current.add(ctrl);
          try {
            const att = await api.addAttachment({ params: { id }, file: item.file, signal: ctrl.signal });
            qc.setQueryData<Entry>(qk.entry(id), (e) =>
              e ? { ...e, attachments: [...e.attachments.filter((a) => a.id !== att.id), att] } : e,
            );
            setUploads((u) => u.filter((x) => x.key !== item.key));
            URL.revokeObjectURL(item.preview);
          } catch (err) {
            if (ctrl.signal.aborted) return;
            setUploads((u) => u.map((x) => (x.key === item.key ? { ...x, error: errorMessage(err) } : x)));
          } finally {
            controllers.current.delete(ctrl);
            inFlight.current--;
          }
        }),
      );
      void qc.invalidateQueries({ queryKey: qk.entry(id) });
      void qc.invalidateQueries({ queryKey: qk.entriesAll });
    },
    [engine, existing, qc],
  );

  const dismiss = useCallback(
    (key: string) =>
      setUploads((u) => {
        const item = u.find((x) => x.key === key);
        if (item) URL.revokeObjectURL(item.preview);
        return u.filter((x) => x.key !== key);
      }),
    [],
  );

  return { uploads, addFiles, dismiss };
}

type PhotosProps = {
  entryId: string;
  attachments: Attachment[];
  uploads: Upload[];
  onAdd: (files: File[]) => void;
  onDismissUpload: (key: string) => void;
};

export const Photos = memo(function Photos({ entryId, attachments, uploads, onAdd, onDismissUpload }: PhotosProps) {
  const input = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const del = useDeleteAttachment(entryId);
  const count = attachments.length + uploads.filter((u) => !u.error).length;
  const full = count >= LIMITS.attachmentsPerEntry;

  return (
    <section aria-label="Photos" className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-fg-muted">Photos</h3>
        <span className="text-xs text-fg-faint">
          {count} of {LIMITS.attachmentsPerEntry}
        </span>
      </div>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {attachments.map((a) => (
          <li key={a.id} className="group relative aspect-square overflow-hidden rounded-control bg-sunken">
            <button
              type="button"
              onClick={() => setViewing(a)}
              className="block size-full"
              aria-label={a.description ? `View photo: ${a.description}` : 'View photo'}
            >
              <img
                src={a.url}
                alt={a.description ?? 'Photo attached to this entry'}
                loading="lazy"
                className="size-full object-cover"
              />
            </button>
            <button
              type="button"
              aria-label="Remove photo"
              onClick={() => setRemoving(a)}
              className="absolute top-1 right-1 grid size-8 place-items-center rounded-full bg-ink/80 text-fg opacity-100 backdrop-blur transition-opacity hover:bg-ink sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </li>
        ))}
        {uploads.map((u) => (
          <li key={u.key} className="relative aspect-square overflow-hidden rounded-control bg-sunken">
            <img src={u.preview} alt="" className="size-full object-cover opacity-50" />
            {u.error ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-ink/85 p-1.5 text-center">
                <span className="line-clamp-3 text-[11px] leading-tight text-danger">{u.error}</span>
                <button type="button" onClick={() => onDismissUpload(u.key)} className="text-xs font-medium text-fg underline">
                  Dismiss
                </button>
              </div>
            ) : (
              <span className="absolute inset-0 grid place-items-center" role="status">
                <LoaderCircle className="size-5 animate-spin text-fg motion-reduce:animate-none" aria-hidden="true" />
                <span className="sr-only">Uploading {u.name}</span>
              </span>
            )}
          </li>
        ))}
        {!full && (
          <li className="aspect-square">
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="flex size-full flex-col items-center justify-center gap-1 rounded-control border border-dashed border-line-strong text-fg-faint transition-colors hover:border-lamp hover:text-lamp"
            >
              <ImagePlus className="size-5" aria-hidden="true" />
              <span className="text-xs">Add photos</span>
            </button>
          </li>
        )}
      </ul>
      <p className="mt-2 text-xs text-fg-faint">Drop or paste photos anywhere on the page. JPEG, PNG, WebP or HEIC up to 8 MB.</p>
      <input
        ref={input}
        type="file"
        accept={PHOTO_TYPES.join(',')}
        multiple
        hidden
        onChange={(e) => {
          onAdd([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this photo?"
        description="The photo will be deleted from this entry. Your writing stays as it is."
        confirmLabel="Remove photo"
        tone="danger"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await del.mutateAsync(removing.id);
            toast('Photo removed');
          } catch (err) {
            toast(errorMessage(err), { tone: 'danger' });
          }
          setRemoving(null);
        }}
      />
      <Dialog
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(null)}
        title="Photo"
        description={viewing?.description ?? undefined}
      >
        {viewing && (
          <img src={viewing.url} alt={viewing.description ?? 'Photo attached to this entry'} className="max-h-[70vh] w-full rounded-control object-contain" />
        )}
      </Dialog>
    </section>
  );
});
