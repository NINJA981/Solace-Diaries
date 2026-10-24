import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, Lock, LockOpen, Mail, Plus, Trash2 } from 'lucide-react';
import type { Capsule } from '@solace/shared';
import { Button, ConfirmDialog, EmptyState, IconButton, Skeleton, toast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useTimezone } from '@/lib/session';
import { useVoice } from '@/lib/voice';
import { InlineError } from '../journal-core/EntryCard';
import { useCapsules, useDeleteCapsule } from '../journal-core/queries-v3';
import { CapsuleComposer } from './CapsuleComposer';
import { CapsuleReveal } from './CapsuleReveal';
import { capsuleStatus, formatUnlock, sortCapsules, timeUntil } from './capsuleLogic';

export default function CapsulesPage() {
  const tz = useTimezone();
  const voice = useVoice();
  const [params, setParams] = useSearchParams();
  const list = useCapsules();
  const del = useDeleteCapsule();
  const [now] = useState(() => new Date());
  const [revealing, setRevealing] = useState<Capsule | null>(null);
  const [deleting, setDeleting] = useState<Capsule | null>(null);
  const composing = params.get('new') === '1';

  const setComposing = (on: boolean) =>
    setParams((p) => {
      if (on) p.set('new', '1');
      else p.delete('new');
      return p;
    }, { replace: true });

  const items = useMemo(() => sortCapsules(list.data ?? [], now), [list.data, now]);
  const groups = {
    ready: items.filter((c) => capsuleStatus(c, now) === 'ready'),
    sealed: items.filter((c) => capsuleStatus(c, now) === 'sealed'),
    opened: items.filter((c) => capsuleStatus(c, now) === 'opened'),
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-16 sm:px-8 sm:pt-10">
      <Link
        to="/app/journal"
        className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-sm text-fg-muted hover:text-fg sm:min-h-8"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Journal
      </Link>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h1 className="type-heading text-3xl text-fg sm:text-4xl">Capsules</h1>
        {!composing && (
          <Button icon={<Plus className="size-4" aria-hidden="true" />} onClick={() => setComposing(true)}>
            {voice.capsuleLinkLabel}
          </Button>
        )}
      </header>

      {composing && (
        <div className="mb-8">
          <CapsuleComposer tz={tz} onDone={() => setComposing(false)} onCancel={() => setComposing(false)} />
        </div>
      )}

      {list.isPending ? (
        <div aria-hidden="true" className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : list.isError ? (
        <InlineError message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        !composing && (
          <EmptyState
            icon={<Mail />}
            title={voice.capsulesEmptyTitle}
            description={voice.capsulesEmptyBody}
            action={<Button onClick={() => setComposing(true)}>{voice.capsuleLinkLabel}</Button>}
          />
        )
      ) : (
        <div className="space-y-8">
          <Group title="Ready to open" capsules={groups.ready} tz={tz} now={now} onOpen={setRevealing} onDelete={setDeleting} />
          <Group title="Sealed" capsules={groups.sealed} tz={tz} now={now} onOpen={setRevealing} onDelete={setDeleting} />
          <Group title="Opened" capsules={groups.opened} tz={tz} now={now} onOpen={setRevealing} onDelete={setDeleting} />
        </div>
      )}

      <CapsuleReveal capsule={revealing} tz={tz} onClose={() => setRevealing(null)} />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this capsule?"
        description={
          deleting && capsuleStatus(deleting, now) !== 'opened'
            ? `“${deleting.title}” hasn’t been opened. Deleting it means the letter is gone for good.`
            : `“${deleting?.title ?? ''}” will be deleted for good.`
        }
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          if (!deleting) return;
          await del.mutateAsync(deleting.id);
          toast(voice.capsuleDeleted);
        }}
      />
    </div>
  );
}

function Group({
  title,
  capsules,
  tz,
  now,
  onOpen,
  onDelete,
}: {
  title: string;
  capsules: Capsule[];
  tz: string;
  now: Date;
  onOpen: (c: Capsule) => void;
  onDelete: (c: Capsule) => void;
}) {
  if (capsules.length === 0) return null;
  const id = `capsules-${title.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-3 text-sm font-medium text-fg-muted">
        {title}
      </h2>
      <ul className="space-y-2">
        {capsules.map((c) => (
          <CapsuleRow key={c.id} capsule={c} tz={tz} now={now} onOpen={() => onOpen(c)} onDelete={() => onDelete(c)} />
        ))}
      </ul>
    </section>
  );
}

function CapsuleRow({
  capsule,
  tz,
  now,
  onOpen,
  onDelete,
}: {
  capsule: Capsule;
  tz: string;
  now: Date;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const voice = useVoice();
  const status = capsuleStatus(capsule, now);
  // A sealed capsule shows only its title and date: the body never reaches this component.
  const detail =
    status === 'sealed'
      ? `Opens ${formatUnlock(capsule.unlockAt, tz)} · ${timeUntil(capsule.unlockAt, now)}`
      : status === 'ready'
        ? `${voice.capsuleReadyLine} · since ${formatUnlock(capsule.unlockAt, tz)}`
        : `Opened ${formatUnlock(capsule.openedAt ?? capsule.unlockAt, tz)}`;
  return (
    <li
      data-status={status}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line bg-surface px-4 py-3"
    >
      <span className="capsule-lock" data-ready={status === 'ready'} aria-hidden="true">
        {status === 'sealed' ? <Lock className="size-5" /> : status === 'ready' ? <Mail className="size-5" /> : <LockOpen className="size-5" />}
      </span>
      <div className="min-w-0 flex-1 basis-40">
        <h3 className="type-heading text-base text-fg [overflow-wrap:anywhere] sm:truncate">{capsule.title}</h3>
        <p className="text-sm text-fg-muted">{detail}</p>
      </div>
      <div className="ml-auto flex items-center gap-1">
      {status !== 'sealed' && (
          <Button variant={status === 'ready' ? 'primary' : 'secondary'} size="sm" onClick={onOpen} aria-label={`${status === 'ready' ? 'Open' : 'Read'} “${capsule.title}”`}>
            {status === 'ready' ? 'Open it' : 'Read'}
          </Button>
        )}
        <IconButton label={`Delete “${capsule.title}”`} icon={<Trash2 />} size="sm" onClick={onDelete} />
      </div>
    </li>
  );
}
