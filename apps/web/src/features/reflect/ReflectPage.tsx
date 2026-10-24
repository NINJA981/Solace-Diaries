import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, Mail, MessagesSquare, RotateCcw } from 'lucide-react';
import { localDate, type ThreadMode } from '@solace/shared';
import { Button, Dialog, EmptyState, buttonClasses, toast } from '@/components/ui';
import { ApiRequestError, errorMessage } from '@/lib/api';
import { useTimezone } from '@/lib/session';
import { useVoice } from '@/lib/voice';
import { InlineError } from '../journal-core/EntryCard';
import { isNotFound, useThread } from '../journal-core/queries';
import { useCreateModeThread } from '../journal-core/queries-v3b';
import { aiErrorCopy } from '../letters/aiErrors';
import { clearStream, retryStream, sendMessage, stopStream, useStream, type StreamState } from './chatStore';
import { Composer } from './Composer';
import { CrisisResources } from '../teen/CrisisResources';
import { Answer, RegenerateButton, UserBubble } from './Messages';
import { ThreadList } from './ThreadList';
import { MODE_OPTIONS, createThreadPayload, modeLabel } from './modes';

export const STARTERS = [
  'What has been on my mind this month?',
  'When did I last feel really calm?',
  'What patterns show up when I’m stressed?',
  'What am I grateful for lately?',
];

function errorCopy(s: StreamState): string {
  const code = s.error?.code;
  if (code === 'ai_quota_exceeded' || code === 'rate_limited' || s.error?.status === 429)
    return aiErrorCopy(new ApiRequestError(s.error?.status ?? 429, s.error?.error ?? '', code === 'ai_quota_exceeded' ? code : 'rate_limited'), 'an answer').message;
  if (code === 'ai_unavailable' || s.error?.status === 503)
    return 'Solace can’t reach its AI service right now. Your question is kept; try again in a minute.';
  return s.error?.error ?? 'The answer didn’t come through. Try again.';
}

export default function ReflectPage() {
  const { threadId } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const tz = useTimezone();
  const voice = useVoice();
  const today = localDate(new Date(), tz);
  const thread = useThread(threadId);
  const stream = useStream(threadId);
  const create = useCreateModeThread();
  const [mode, setMode] = useState<ThreadMode>('open');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);

  const msgs = useMemo(() => thread.data?.messages ?? [], [thread.data]);
  const s = stream;
  const serverHasDone = !!s?.message && msgs.some((m) => m.id === s.message!.id);
  const known = useMemo(() => new Set(s?.knownIds ?? []), [s?.knownIds]);
  const questionStored =
    !!s &&
    !s.regenerate &&
    (s.userMessage
      ? msgs.some((m) => m.id === s.userMessage!.id)
      : msgs.some((m) => m.role === 'user' && !known.has(m.id) && m.content.trim() === s.content.trim()));
  // After a stop or error the server may still have saved an answer; prefer its copy.
  const answerStored =
    !!s && (s.status === 'stopped' || s.status === 'error') && msgs.some((m) => m.role === 'assistant' && !known.has(m.id));
  const regenerating = !!s?.regenerate && (s.status === 'streaming' || (s.status === 'done' && !serverHasDone));
  const lastAssistantIdx = msgs.map((m) => m.role).lastIndexOf('assistant');
  const visible = regenerating && lastAssistantIdx === msgs.length - 1 ? msgs.slice(0, -1) : msgs;
  const busy = s?.status === 'streaming' || !!starting;

  // Once the server copy of a finished answer is in the cache, drop the live copy.
  useEffect(() => {
    if (threadId && s?.status === 'done' && serverHasDone) clearStream(threadId);
  }, [threadId, s?.status, serverHasDone]);

  useEffect(() => {
    if (threadId && answerStored) clearStream(threadId);
  }, [threadId, answerStored]);


  const scrollToBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Follow the answer only while the reader is at the bottom.
  useEffect(() => {
    if (atBottom.current) scrollToBottom();
  }, [visible.length, s?.text, s?.status, starting, scrollToBottom]);
  const showJump = awayFromBottom && s?.status === 'streaming';

  useEffect(() => {
    atBottom.current = true;
    requestAnimationFrame(() => scrollToBottom());
  }, [threadId, thread.isSuccess, scrollToBottom]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottom.current = near;
    if (near === awayFromBottom) setAwayFromBottom(!near);
  };

  const ask = async (text: string) => {
    atBottom.current = true;
    if (threadId) {
      void sendMessage(qc, threadId, text);
      return;
    }
    setStarting(text);
    try {
      const t = await create.mutateAsync(createThreadPayload(mode, text));
      void sendMessage(qc, t.id, text);
      navigate(`/app/reflect/${t.id}`);
      // The live stream state takes over from the optimistic first question.
      setStarting(null);
    } catch (err) {
      setStarting(null);
      toast(errorMessage(err), { tone: 'danger' });
    }
  };

  const beginGuided = async () => {
    try {
      const label = MODE_OPTIONS.find((m) => m.mode === mode)?.label;
      const t = await create.mutateAsync(createThreadPayload(mode, label));
      navigate(`/app/reflect/${t.id}`);
    } catch (err) {
      toast(errorMessage(err), { tone: 'danger' });
    }
  };

  const regenerateLast = () => {
    if (!threadId) return;
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    if (lastUser) void sendMessage(qc, threadId, lastUser.content, { regenerate: true });
  };

  const title = threadId ? thread.data?.title.trim() || 'Reflection' : 'Reflect';
  const liveText =
    s?.status === 'streaming'
      ? 'Solace is answering…'
      : s?.status === 'done' && s.message
        ? `Solace answered. ${s.message.content.slice(0, 280)}`
        : s?.status === 'error'
          ? errorCopy(s)
          : s?.status === 'stopped'
            ? 'Answer stopped.'
            : '';

  const notFound = threadId && thread.isError && isNotFound(thread.error);

  return (
    <div className="flex h-[calc(100dvh-7.5rem-env(safe-area-inset-bottom))] md:h-dvh">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line px-3 py-6 md:flex">
        <ThreadList activeId={threadId} />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col" aria-labelledby="reflect-title">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-8">
          <h1 id="reflect-title" className="min-w-0 truncate type-heading text-xl text-fg">
            {title}
          </h1>
          {threadId && modeLabel(thread.data?.mode) && (
            <span className="shrink-0 rounded-full border border-ai/30 bg-ai-soft px-2.5 py-0.5 text-xs font-medium text-ai">{modeLabel(thread.data?.mode)}</span>
          )}
          <span className="flex-1" />
          <Button variant="ghost" size="sm" className="shrink-0 max-md:h-11 md:hidden" icon={<MessagesSquare className="size-4" aria-hidden="true" />} onClick={() => setSheetOpen(true)}>
            Past reflections
          </Button>
        </header>

        <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto px-4 sm:px-8">
          <div className="mx-auto w-full max-w-3xl space-y-8 py-8">
            {!threadId && !starting && (
              <div className="pt-4 sm:pt-10">
                <p className="max-w-[34ch] type-heading text-3xl leading-tight text-fg sm:text-4xl">{voice.reflectIntroTitle}</p>
                <p className="mt-3 max-w-prose text-fg-muted">
                  {voice.reflectIntroBody}
                </p>
                <fieldset className="mt-8">
                  <legend className="text-sm font-medium text-fg">How would you like to reflect?</legend>
                  <p className="mt-0.5 text-sm text-fg-muted">{voice.guidedIntro}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {MODE_OPTIONS.map((m) => (
                      <label
                        key={m.mode}
                        className="flex min-h-14 cursor-pointer flex-col rounded-card border border-line bg-surface px-4 py-3 transition-colors has-[:checked]:border-ai has-[:checked]:bg-ai-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus hover:border-ai/50"
                      >
                        <input type="radio" name="reflect-mode" value={m.mode} checked={mode === m.mode} onChange={() => setMode(m.mode)} className="sr-only" />
                        <span className="text-sm font-medium text-fg">{m.label}</span>
                        <span className="mt-0.5 text-xs leading-relaxed text-fg-muted">{m.description}</span>
                      </label>
                    ))}
                  </div>
                  {mode !== 'open' && (
                    <Button className="mt-3" variant="primary" size="sm" onClick={() => void beginGuided()} loading={create.isPending}>
                      Begin {MODE_OPTIONS.find((m) => m.mode === mode)?.label.toLowerCase()}
                    </Button>
                  )}
                </fieldset>
                <Link
                  to="/app/reflect/letters"
                  className="mt-4 flex items-center gap-3 rounded-card border border-ai/30 bg-ai-soft px-4 py-3 text-sm text-fg transition-colors hover:border-ai/60"
                >
                  <Mail className="size-4 shrink-0 text-ai" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">Letters from past you</span>
                    <span className="block text-xs text-fg-muted">A monthly letter in your own voice, from older entries. You can write back.</span>
                  </span>
                </Link>
                <ul className="mt-8 grid gap-2 sm:grid-cols-2" aria-label="Questions to start with">
                  {STARTERS.map((q) => (
                    <li key={q}>
                      <button
                        type="button"
                        onClick={() => void ask(q)}
                        className="flex min-h-14 w-full items-center rounded-card border border-line bg-surface px-4 py-3 text-left font-prose text-note text-fg transition-colors hover:border-ai/50 hover:bg-ai-soft"
                      >
                        {q}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {notFound ? (
              <EmptyState
                title="This reflection isn’t here"
                description="It may have been deleted."
                action={
                  <Link to="/app/reflect" className={buttonClasses('secondary')}>
                    Start a new reflection
                  </Link>
                }
              />
            ) : threadId && thread.isError ? (
              <InlineError message="Couldn’t load this conversation." onRetry={() => void thread.refetch()} />
            ) : threadId && thread.isPending ? (
              <div aria-hidden="true" className="space-y-6">
                <div className="ml-auto h-10 w-2/3 animate-pulse rounded-card bg-sunken" />
                <div className="h-24 w-full animate-pulse rounded-card bg-sunken" />
              </div>
            ) : null}

            {visible.map((m, i) =>
              m.role === 'user' ? (
                <UserBubble key={m.id} content={m.content} />
              ) : (
                <Answer
                  key={m.id}
                  idBase={m.id}
                  content={m.content}
                  citations={m.citations}
                  today={today}
                  footer={
                    i === visible.length - 1 && !s && !busy ? <RegenerateButton onClick={regenerateLast} /> : undefined
                  }
                />
              ),
            )}

            {starting && <UserBubble content={starting} pending />}
            {s && !s.regenerate && !questionStored && <UserBubble content={s.content} pending={s.status === 'streaming'} />}
            {(starting || s?.status === 'streaming') && (
              <Answer idBase="live" content={s?.status === 'streaming' ? s.text : ''} citations={s?.citations ?? []} streaming today={today} />
            )}
            {s?.status === 'done' && s.message && !serverHasDone && (
              <Answer idBase={s.message.id} content={s.message.content} citations={s.message.citations} today={today} />
            )}
            {s?.status === 'stopped' && (
              <Answer
                idBase="stopped"
                content={s.text}
                citations={s.citations}
                partial
                today={today}
                footer={
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-fg-faint">
                    <span>You stopped this answer.</span>
                    <button
                      type="button"
                      onClick={() => threadId && void retryStream(qc, threadId)}
                      className="inline-flex h-11 items-center gap-1.5 font-medium text-fg-muted underline underline-offset-2 hover:text-fg sm:h-8"
                    >
                      <RotateCcw className="size-3.5" aria-hidden="true" />
                      Answer again
                    </button>
                  </div>
                }
              />
            )}
            {s?.status === 'error' && (
              <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-fg">
                <span className="min-w-0 flex-1">
                  {errorCopy(s)}{' '}
                  {(s.error?.code === 'ai_quota_exceeded' || s.error?.code === 'rate_limited' || s.error?.status === 429) && (
                    <Link to="/app/settings#gemini" className="font-medium underline underline-offset-2">
                      Open Settings
                    </Link>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => threadId && void retryStream(qc, threadId)}
                  className="inline-flex h-11 items-center gap-1.5 rounded-control px-2 font-medium underline underline-offset-2 sm:h-8"
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Try again
                </button>
              </div>
            )}
          </div>
          {showJump && (
            <button
              type="button"
              onClick={() => {
                atBottom.current = true;
                setAwayFromBottom(false);
                scrollToBottom(true);
              }}
              className="sticky bottom-3 left-1/2 mx-auto flex h-10 -translate-x-0 items-center gap-1.5 rounded-full border border-line-strong bg-raised px-4 text-sm text-fg shadow-1"
            >
              <ArrowDown className="size-4" aria-hidden="true" />
              Jump to latest
            </button>
          )}
        </div>

        <div className="border-t border-line bg-canvas px-4 pt-3 pb-3 sm:px-8 sm:pb-5">
          <Composer
            streaming={s?.status === 'streaming'}
            disabled={!!starting || !!notFound}
            onSend={(t) => void ask(t)}
            onStop={() => threadId && stopStream(threadId)}
          />
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="mt-1 -ml-2 inline-flex min-h-11 items-center rounded-control px-2 text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline sm:min-h-8"
          >
            Need to talk to someone?
          </button>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {liveText}
        </p>
      </section>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen} title="Need to talk to someone?">
        <CrisisResources headingLevel={3} title="Free, private help lines" />
      </Dialog>

      <Dialog open={sheetOpen} onOpenChange={setSheetOpen} title="Past reflections">
        <ThreadList activeId={threadId} onNavigate={() => setSheetOpen(false)} />
      </Dialog>
    </div>
  );
}
