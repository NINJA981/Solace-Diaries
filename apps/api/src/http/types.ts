import type { Request } from 'express';

export type AuthContext = { userId: string; email: string };

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `requireAuth` (owned by the platform layer). */
    auth?: AuthContext;
    /** Optional bring-your-own Gemini key from the `x-gemini-key` header. Never log it. */
    geminiKey?: string;
    /** Request id, echoed in error bodies and logs. */
    id?: string;
  }
}

/** Narrow a request that passed `requireAuth`. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw new Error('authOf() used on a route without requireAuth');
  return req.auth;
}
