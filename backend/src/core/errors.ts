/* HTTP errors a handler can throw. The router turns them into a JSON reply
   with the right status; anything else becomes a 500 with a correlation id
   and the details go to the server log, never to the browser. */

export class HttpError extends Error {
  status: number;
  field?: string;
  code?: string;
  retryAfter?: number;
  details?: Record<string, unknown>;

  constructor(status: number, message: string, field?: string, code?: string) {
    super(message);
    this.status = status;
    this.field = field;
    this.code = code;
  }
}

export const bad = (message: string, field?: string): never => { throw new HttpError(400, message, field); };
export const unauthorised = (message = 'Please sign in again.', code = 'session_expired'): never => {
  throw new HttpError(401, message, undefined, code);
};
export const forbid = (message = 'You do not have permission to do this.'): never => { throw new HttpError(403, message); };
export const missing = (message = 'That record could not be found.'): never => { throw new HttpError(404, message); };
export const conflict = (message: string): never => { throw new HttpError(409, message); };
export const tooMany = (message: string, retryAfter = 60): never => {
  const error = new HttpError(429, message);
  error.retryAfter = retryAfter;
  throw error;
};
