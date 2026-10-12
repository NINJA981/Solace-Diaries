import { ERROR_CODES } from '@solace/shared';

/** Throw from any handler; the central error middleware turns it into an ApiError body. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = ERROR_CODES.internal,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what, ERROR_CODES.notFound);
export const badRequest = (msg: string, fields?: Record<string, string>) =>
  new HttpError(400, msg, ERROR_CODES.validation, fields);
export const unauthorized = (msg = 'Sign in to continue.') =>
  new HttpError(401, msg, ERROR_CODES.unauthorized);
export const conflict = (msg: string, code: string = ERROR_CODES.versionConflict) =>
  new HttpError(409, msg, code);
export const aiUnavailable = (msg = 'Solace could not reach its AI service. Try again in a moment.') =>
  new HttpError(503, msg, ERROR_CODES.aiUnavailable);
export const quotaExceeded = () =>
  new HttpError(
    429,
    "You've reached today's AI limit. Add your own Gemini key in Settings or try again tomorrow.",
    ERROR_CODES.quotaExceeded,
  );
