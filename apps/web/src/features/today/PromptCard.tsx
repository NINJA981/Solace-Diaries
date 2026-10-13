import type { DailyPrompt } from '@solace/shared';
import { Button } from '@/components/ui';

type Props = {
  prompt: DailyPrompt;
  onWrite: () => void;
  onDismiss: () => void;
};

/** Today's question, in Solace's voice (dusk). */
export function PromptCard({ prompt, onWrite, onDismiss }: Props) {
  return (
    <section
      aria-labelledby="today-prompt"
      className="rounded-card border border-dusk/25 bg-dusk-soft px-5 py-4 sm:px-6 sm:py-5"
    >
      <p className="text-xs font-medium text-dusk">
        {prompt.source === 'memory' ? 'From something you wrote recently' : 'A question for today'}
      </p>
      <p id="today-prompt" className="mt-1.5 font-serif text-xl leading-snug text-fg">
        {prompt.text}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onWrite} className="max-sm:h-11">
          Write about this
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss} className="max-sm:h-11">
          Not today
        </Button>
      </div>
    </section>
  );
}
