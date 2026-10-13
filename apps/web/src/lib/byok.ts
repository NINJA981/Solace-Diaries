/**
 * Optional bring-your-own Gemini key. Lives only in this browser's localStorage when the
 * user opts in, and is sent to the API as the `x-gemini-key` header. The API never stores
 * or logs it.
 */
const KEY = 'solace.geminiKey';

/** Google AI Studio keys look like `AIza` + 35 URL-safe characters. */
export const GEMINI_KEY_PATTERN = /^AIza[0-9A-Za-z_-]{35}$/;

export function isPlausibleGeminiKey(value: string): boolean {
  return GEMINI_KEY_PATTERN.test(value.trim());
}

export function getGeminiKey(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setGeminiKey(value: string | null): void {
  try {
    if (value) localStorage.setItem(KEY, value.trim());
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the key simply isn't remembered */
  }
}

/** Shows only the last 4 characters, for display. */
export function maskKey(value: string): string {
  return `AIza••••••••${value.slice(-4)}`;
}
