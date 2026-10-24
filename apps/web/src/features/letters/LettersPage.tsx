import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Mail, Reply } from 'lucide-react';
import { LIMITS, localDate, type PastLetter } from '@solace/shared';
import { Button, EmptyState, Skeleton, Textarea, toast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useTimezone } from '@/lib/session';
import { useVoice } from '@/lib/voice';
import { InlineError } from '../journal-core/EntryCard';
import { useLetters, useReplyToLetter, useWriteLetter } from '../journal-core/queries-v3b';
import { aiErrorCopy } from './aiErrors';
import { CitedMarkdown } from './CitedMarkdown';
import { monthTitle, writeState } from './letterState';

export function AiErrorNote({ copy }: { copy: { message: string; suggestKey: boolean } }) {
  return (
    <p role="alert" className="mt-3 max-w-prose text-sm text-fg">
      {copy.message}{' '}
      {copy.suggestKey && (
        <Link to="/app/settings#gemini" className="font-medium text-accent underline underline-offset-2">
          Open Settings
        </Link>
      )}
    </p>
  );
}

function ReplyBox({ letter }: { letter: PastLetter }) {
  const reply = useReplyToLetter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');

  if (letter.replyEntryId) {
    return (
      <p className="mt-4 text-sm">
        <Link to={`/app/entries/${letter.replyEntryId}`} className="font-medium text-accent underline underline-offset-2">
          Read your reply to past you
        </Link>
      </p>
    );
  }
  if (!open)
    return (
      <Button variant="secondary" size="sm" className="mt-4" onClick={() => setOpen(true)} icon={<Reply className="size-4" aria-hidden="true" />}>
        Reply to past me
      </Button>
    );
  return (
    <form
      className="mt-4 max-w-prose"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        reply.mutate(
          { id: letter.id, body: body.trim() },
          { onSuccess: () => toast('Reply saved as a journal entry'), onError: (err) => toast(errorMessage(err), { tone: 'danger' }) },
        );
      }}
    >
      <Textarea
        label="Your reply"
        hint="It’s saved as a new journal entry linked to this letter."
        value={body}
        maxLength={LIMITS.bodyMax}
        rows={5}
        onChange={(e) => setBody(e.target.value)}
        autoFocus
      />
      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" loading={reply.isPending} disabled={!body.trim()}>
          Save reply
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function LettersPage() {
  const tz = useTimezone();
  const today = localDate(new Date(), tz);
  const voice = useVoice();
  const list = useLetters();
  const write = useWriteLetter(tz);
  const state = list.data ? writeState(list.data, today.slice(0, 7)) : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-20 sm:px-8 sm:pt-10">
      <Link to="/app/reflect" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-sm text-fg-muted hover:text-fg sm:min-h-8">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Reflect
      </Link>
      <h1 className="mt-2 type-heading text-3xl text-fg sm:text-4xl">Letters from past you</h1>
      <p className="mt-2 max-w-prose text-fg-muted">
        Once a month Solace writes you a letter in your own voice, from entries you wrote a while back. You can write back.
      </p>

      <div className="mt-6">
        <Button
          loading={write.isPending}
          disabled={!state?.canWrite}
          aria-describedby="letter-why"
          icon={<Mail className="size-4" aria-hidden="true" />}
          onClick={() => write.mutate(undefined, { onSuccess: () => toast('Your letter is here') })}
        >
          Write this month’s letter
        </Button>
        {state && !state.canWrite && (
          <p id="letter-why" className="mt-2 max-w-prose text-sm text-fg-muted">
            {state.reason}
          </p>
        )}
        {write.isPending && (
          <p role="status" className="mt-3 text-sm text-ai">
            Solace is reading older entries…
          </p>
        )}
        {write.isError && <AiErrorNote copy={aiErrorCopy(write.error, 'the letter')} />}
      </div>

      <div className="mt-10 space-y-10">
        {list.isPending ? (
          <Skeleton className="h-48 rounded-card" />
        ) : list.isError ? (
          <InlineError message="Couldn’t load your letters." onRetry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <div className="rounded-card border border-line bg-sunken">
            <EmptyState icon={<Mail />} title="No letters yet" description={voice.lettersEmpty} />
          </div>
        ) : (
          list.data.items.map((l) => (
            <article key={l.id} aria-labelledby={`letter-${l.id}`} className="rounded-card border border-ai/25 bg-ai-soft px-5 py-5 sm:px-7 sm:py-6">
              <h2 id={`letter-${l.id}`} className="type-heading text-xl text-fg">
                {monthTitle(l.month)}
              </h2>
              <p className="mb-4 text-xs text-ai">From past you, written by Solace</p>
              <CitedMarkdown content={l.content} citations={l.citations} today={today} idBase={`letter-${l.id}`} className="max-w-[64ch]" />
              <ReplyBox letter={l} />
            </article>
          ))
        )}
      </div>
    </div>
  );
}
