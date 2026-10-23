import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { localDate } from '@solace/shared';
import { ConfirmDialog, EmptyState, buttonClasses, toast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useSession, useTimezone } from '@/lib/session';
import { voiceNow } from '@/lib/voice';
import { Editor } from '../journal-core/editor/Editor';
import { EditorSkeleton } from '../journal-core/editor/EditorSkeleton';
import { deleteEntryEverywhere } from '../journal-core/editor/registry';
import { useEngineSelector, useEntryEditor } from '../journal-core/editor/useEntryEditor';
import { useDraftSync } from '../journal-core/editor/useDraftSync';
import { InlineError } from '../journal-core/EntryCard';
import { formatLongDay } from '../journal-core/format';
import { useDeleteEntry } from '../journal-core/queries';

export default function EntryPage() {
  const { id = '' } = useParams();
  const tz = useTimezone();
  const today = localDate(new Date(), tz);
  const navigate = useNavigate();
  const { userId } = useSession();
  const [confirming, setConfirming] = useState(false);
  const del = useDeleteEntry();
  useDraftSync();

  const editor = useEntryEditor(id, { fetchServer: true, allowMissing: false, entryDate: today });
  const { load } = editor;
  const entryDate = useEngineSelector(editor.engine, (s) => s.fields.entryDate);

  const deleteEntry = async () => {
    if (!userId) return;
    try {
      // Stops autosave and drops the device draft first, waits out a first save that is
      // still in flight, then sends the (idempotent) DELETE, so nothing can recreate it.
      await deleteEntryEverywhere(userId, id, (entryId) => del.mutateAsync(entryId));
      setConfirming(false);
      navigate('/app/journal');
      toast(voiceNow().entryDeleted);
    } catch (err) {
      // Autosave is already stopped here, so don't leave a dead editor on screen: the entry
      // (as last saved) is still in the journal, where deleting can be tried again.
      setConfirming(false);
      navigate('/app/journal');
      toast(`Couldn’t delete the entry. ${errorMessage(err)}`, { tone: 'danger' });
    }
  };

  return (
    <div className="mx-auto w-full max-w-[52rem] px-4 pt-4 pb-16 sm:px-8 sm:pt-8">
      <Link
        to="/app/journal"
        className="-ml-2 inline-flex h-11 items-center gap-1.5 rounded-control px-2 text-sm text-fg-muted hover:text-fg sm:h-9"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Journal
      </Link>

      {load.state === 'notFound' ? (
        <EmptyState
          title="This entry isn’t here"
          description="It may have been deleted, or the link is from another account."
          action={
            <Link to="/app/journal" className={buttonClasses('secondary')}>
              Back to your journal
            </Link>
          }
        />
      ) : load.state === 'error' ? (
        <div className="mt-6">
          <h1 className="sr-only">Entry</h1>
          <InlineError message={errorMessage(load.error)} onRetry={load.retry} />
        </div>
      ) : (
        <div className="mt-4">
          <h1 className="sr-only">
            {entryDate ? `Entry from ${formatLongDay(entryDate)}` : 'Entry'}
          </h1>
          {load.state === 'ready' ? (
            <Editor
              key={load.engine.id}
              engine={load.engine}
              server={editor.server}
              dateMode="picker"
              today={today}
              onDelete={() => setConfirming(true)}
              onGone={() => navigate('/app/journal')}
            />
          ) : (
            <EditorSkeleton />
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this entry?"
        description="The entry, its photos and anything Solace learned only from it will be removed. This can’t be undone."
        confirmLabel="Delete entry"
        tone="danger"
        onConfirm={deleteEntry}
      />
    </div>
  );
}
