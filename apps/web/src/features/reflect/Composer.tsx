import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { LIMITS } from '@solace/shared';
import { IconButton } from '@/components/ui';
import '../journal-core/journal.css';

type Props = {
  streaming: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  autoFocus?: boolean;
};

const supportsFieldSizing = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content');

/** Enter sends, Shift+Enter adds a line. Grows with the question up to a few lines. */
export function Composer({ streaming, disabled, onSend, onStop, autoFocus }: Props) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const hintId = useId();
  const remaining = LIMITS.chatMessageMax - value.length;
  const nearLimit = value.length > LIMITS.chatMessageMax * 0.8;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || supportsFieldSizing) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const send = () => {
    const text = value.trim();
    if (!text || streaming || disabled) return;
    onSend(text);
    setValue('');
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className="mx-auto w-full max-w-3xl"
    >
      <div className="flex items-end gap-2 rounded-card border border-line-strong bg-surface p-2 shadow-[var(--shadow-card)] focus-within:border-lamp/60">
        <label htmlFor={id} className="sr-only">
          Ask about your journal
        </label>
        <textarea
          id={id}
          ref={ref}
          value={value}
          rows={1}
          autoFocus={autoFocus}
          maxLength={LIMITS.chatMessageMax}
          aria-describedby={hintId}
          placeholder="Ask about your journal…"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          className="journal-writing journal-autogrow journal-caret max-h-[200px] min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-base leading-snug text-fg placeholder:text-fg-faint focus-visible:outline-none"
        />
        {streaming ? (
          <IconButton label="Stop answer" icon={<Square className="size-4 fill-current" />} variant="secondary" onClick={onStop} className="size-11 shrink-0" />
        ) : (
          <IconButton
            type="submit"
            label="Send question"
            icon={<ArrowUp className="size-5" />}
            variant="primary"
            disabled={!value.trim() || disabled}
            className="size-11 shrink-0"
          />
        )}
      </div>
      <div id={hintId} className="mt-2 flex items-start justify-between gap-3 px-1 text-xs text-fg-faint">
        <p>Answers come only from your entries. Solace can be wrong.</p>
        {nearLimit && (
          <p className={remaining < 100 ? 'text-danger' : undefined} aria-live="polite">
            {remaining.toLocaleString()} left
          </p>
        )}
      </div>
    </form>
  );
}
