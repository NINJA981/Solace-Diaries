import { baseVoice, type VoicePack } from '@/lib/voice';
import { moonPhase } from '@/lib/sky';

/**
 * Lamplight speaks the base voice (lib/voice.ts): quiet, plain, unhurried. The sky adds one
 * thing: on the few nights the moon is at a turning point, the greeting says so, once, softly.
 * Every other greeting is the base string word for word.
 */
const NIGHT_LINES: Record<string, string> = {
  'New moon': 'No moon tonight.',
  'Full moon': 'The moon is full tonight.',
};

/** Hours after which "tonight" is true (matches the sky: the light has gone by 19:00). */
const isEvening = (hour: number) => hour >= 18 || hour < 5;

const voice: Partial<VoicePack> = {
  greeting: ({ hour, name }) => {
    const base = baseVoice.greeting({ hour, name });
    if (!isEvening(hour)) return base;
    const line = NIGHT_LINES[moonPhase(new Date()).name];
    return line ? `${base}. ${line}` : base;
  },
};
export default voice;
