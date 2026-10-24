import { useState } from 'react';
import { clsx } from 'clsx';
import { CAPSULE_LIMITS, localDate } from '@solace/shared';
import { Button, ConfirmDialog, Input, Textarea, toast } from '@/components/ui';
import { useVoice } from '@/lib/voice';
import { useCreateCapsule } from '../journal-core/queries-v3';
import {
  PRESETS,
  earliestDate,
  formatUnlock,
  latestDate,
  localInstant,
  presetDate,
  validateDraft,
  type CapsuleDraftErrors,
  type Preset,
} from './capsuleLogic';

/** Write to future you: title, letter, an unlock day, and a clear "you can't read it until then" step. */
export function CapsuleComposer({ tz, onDone, onCancel }: { tz: string; onDone: () => void; onCancel: () => void }) {
  const voice = useVoice();
  const create = useCreateCapsule();
  const [now] = useState(() => new Date());
  const today = localDate(now, tz);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [preset, setPreset] = useState<Preset>('6m');
  const [custom, setCustom] = useState('');
  const [errors, setErrors] = useState<CapsuleDraftErrors>({});
  const [confirming, setConfirming] = useState(false);

  const date = preset === 'custom' ? custom : presetDate(preset, today);
  const when = date && !validateDraft({ title: 'x', body: 'x', date }, new Date(), tz).date ? formatUnlock(localInstant(date, tz).toISOString(), tz) : null;

  const review = () => {
    const found = validateDraft({ title, body, date }, new Date(), tz);
    setErrors(found);
    if (Object.keys(found).length === 0) setConfirming(true);
  };

  const seal = async () => {
    await create.mutateAsync({ title: title.trim(), body: body.trim(), unlockAt: localInstant(date, tz).toISOString() });
    toast(voice.capsuleSealed(formatUnlock(localInstant(date, tz).toISOString(), tz)), { tone: 'success' });
    onDone();
  };

  return (
    <section aria-labelledby="capsule-composer" className="rounded-card border border-line bg-surface px-5 py-6 sm:px-7">
      <h2 id="capsule-composer" className="type-heading text-xl text-fg">
        {voice.capsuleLinkLabel}
      </h2>
      <p className="mt-1 mb-5 text-sm text-fg-muted">{voice.capsuleLinkHint}</p>

      <form
        noValidate
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          review();
        }}
      >
        <Input
          label="Title"
          value={title}
          maxLength={CAPSULE_LIMITS.titleMax}
          error={errors.title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          label="Your letter"
          rows={9}
          value={body}
          error={errors.body}
          className="font-prose text-prose leading-prose"
          onChange={(e) => setBody(e.target.value)}
        />

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg">Open it in</legend>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                aria-pressed={preset === p.value}
                onClick={() => {
                  setPreset(p.value);
                  setErrors((e) => ({ ...e, date: undefined }));
                }}
                className={clsx(
                  'inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium sm:min-h-9',
                  preset === p.value ? 'border-accent/60 bg-accent-soft text-accent' : 'border-line text-fg-muted hover:border-line-strong hover:text-fg',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <Input
              type="date"
              label="Opening day"
              containerClassName="mt-3 max-w-xs"
              value={custom}
              min={earliestDate(now, tz)}
              max={latestDate(now, tz)}
              error={errors.date}
              onChange={(e) => setCustom(e.target.value)}
            />
          )}
          {preset !== 'custom' && errors.date && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {errors.date}
            </p>
          )}
          {when && (
            <p className="mt-3 text-sm text-fg-muted" data-testid="capsule-when">
              Opens on {when}.
            </p>
          )}
        </fieldset>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">Seal letter</Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Seal this letter?"
        description={
          <>
            You won’t be able to read “{title.trim()}” until {when ?? 'the day you chose'}. Not even you can peek.
            You can still delete it before then.
          </>
        }
        confirmLabel="Seal it"
        onConfirm={seal}
      />
    </section>
  );
}
