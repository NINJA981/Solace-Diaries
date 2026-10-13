/** Tiny registry so the API client can trigger the session's sign-out flow without importing it. */
type UnauthorizedHandler = () => void | Promise<void>;
let onUnauthorized: UnauthorizedHandler | null = null;
let handling = false;

/** SessionProvider registers the global sign-out flow here. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

export function fireUnauthorized(): void {
  if (handling || !onUnauthorized) return;
  handling = true;
  const handler = onUnauthorized;
  void Promise.resolve()
    .then(() => handler())
    .catch(() => {})
    .finally(() => {
      handling = false;
    });
}
