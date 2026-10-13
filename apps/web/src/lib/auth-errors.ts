/** Maps Supabase Auth errors to sentences a person can act on. */
type AuthLikeError = { message?: string; code?: string; status?: number; name?: string } | null | undefined;

const BY_CODE: Record<string, string> = {
  invalid_credentials: 'That email and password don’t match. Check both and try again, or reset your password.',
  email_not_confirmed: 'Confirm your email address first. Use the link we sent when you signed up.',
  user_already_exists: 'An account with this email already exists. Sign in instead.',
  email_exists: 'An account with this email already exists. Sign in instead.',
  weak_password: 'Choose a stronger password: at least 10 characters. A few unrelated words work well.',
  same_password: 'Your new password needs to be different from your current one.',
  over_email_send_rate_limit: 'We’ve sent several emails already. Wait a minute, then try again.',
  over_request_rate_limit: 'Too many attempts in a short time. Wait a minute, then try again.',
  email_address_invalid: 'Enter a valid email address, like name@example.com.',
  validation_failed: 'Check the details you entered and try again.',
  otp_expired: 'That link has expired or was already used. Request a new one below.',
  flow_state_not_found: 'Open the link in the same browser you used to request it, or request a new one.',
  flow_state_expired: 'That link has expired. Request a new one below.',
  bad_code_verifier: 'Open the link in the same browser you used to request it, or request a new one.',
  signup_disabled: 'New accounts can’t be created right now. Please try again later.',
  email_provider_disabled: 'Email sign-in isn’t available right now. Try continuing with Google.',
  provider_disabled: 'That sign-in option isn’t available right now. Use your email instead.',
  session_not_found: 'Your session has ended. Sign in again.',
  reauthentication_needed: 'For your security, sign in again before changing this.',
  access_denied: 'Sign-in was cancelled. You can try again whenever you’re ready.',
};

export function authErrorMessage(error: AuthLikeError): string {
  if (!error) return 'Something went wrong. Please try again.';
  if (error.code && BY_CODE[error.code]) return BY_CODE[error.code]!;
  const message = error.message ?? '';
  if (error.name === 'AuthRetryableFetchError' || error.status === 0 || /fetch|network|load failed/i.test(message)) {
    return 'Can’t reach the sign-in service. Check your connection and try again.';
  }
  if (/invalid login credentials/i.test(message)) return BY_CODE.invalid_credentials!;
  if (/email not confirmed/i.test(message)) return BY_CODE.email_not_confirmed!;
  if (/already registered/i.test(message)) return BY_CODE.user_already_exists!;
  if (/rate limit/i.test(message)) return BY_CODE.over_request_rate_limit!;
  if (/password/i.test(message) && /(least|short|weak)/i.test(message)) return BY_CODE.weak_password!;
  return message || 'Something went wrong. Please try again.';
}

export const MIN_PASSWORD = 10;

/** 0 = too short, 1 = okay, 2 = strong. Length matters most; variety helps. */
export function passwordStrength(pw: string): 0 | 1 | 2 {
  if (pw.length < MIN_PASSWORD) return 0;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/, /\s/].filter((r) => r.test(pw)).length;
  return pw.length >= 16 || (pw.length >= 12 && variety >= 3) ? 2 : 1;
}

export function authRedirect(next?: string): string {
  const url = new URL('/auth/callback', window.location.origin);
  if (next) url.searchParams.set('next', next);
  return url.toString();
}
