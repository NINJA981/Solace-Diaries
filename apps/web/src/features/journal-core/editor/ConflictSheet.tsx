import { useState } from 'react';
import { Copy } from 'lucide-react';
import { Button, Dialog, toast } from '@/components/ui';
import { countWords } from '@solace/shared';
import { plural } from '../format';
import type { Conflict, EntryFields } from './syncEngine';

function Version({ label, title, body }: { label: string; title: string; body: string }) {
  return (
    <div className="min-w-0 rounded-control border border-line bg-sunken p-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-fg">{label}</span>
        <span className="text-xs text-fg-faint">{plural(countWords(body), 'word')}</span>
      </div>
      {title && <p className="mb-1 font-prose text-base text-fg">{title}</p>}
      <p className="line-clamp-4 font-prose text-sm leading-relaxed whitespace-pre-wrap text-fg-muted">
        {body || <em className="text-fg-faint">Empty</em>}
      </p>
    </div>
  );
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflict: Conflict;
  mine: EntryFields;
  onResolve: (choice: 'mine' | 'theirs') => Promise<void> | void;
};

/** Calm, explicit choice when the same entry was edited in two places. Nothing is discarded silently. */
export function ConflictSheet({ open, onOpenChange, conflict, mine, onResolve }: Props) {
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(mine.title ? `${mine.title}\n\n${mine.body}` : mine.body);
      toast('Your version is copied');
    } catch {
      toast('Couldn’t reach the clipboard. Select the text in the editor and copy it instead.', { tone: 'danger' });
    }
  };
  const choose = async (c: 'mine' | 'theirs') => {
    setBusy(true);
    try {
      await onResolve(c);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const deleted = conflict.kind === 'deleted';
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={deleted ? 'This entry was deleted elsewhere' : 'This entry changed somewhere else'}
      description={
        deleted
          ? 'It was deleted on another device or tab while you were writing. Your words are still here.'
          : 'It was edited on another device or tab while you were writing here. Choose which version to keep.'
      }
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" icon={<Copy className="size-4" aria-hidden="true" />} onClick={copy}>
            Copy mine
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => choose('theirs')}>
            {deleted ? 'Discard mine' : 'Use the other version'}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => choose('mine')}>
            {deleted ? 'Save mine again' : 'Keep mine'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <Version label="This device" title={mine.title} body={mine.body} />
        {conflict.kind === 'diverged' && (
          <Version label="The other version" title={conflict.server.title} body={conflict.server.body} />
        )}
      </div>
    </Dialog>
  );
}
