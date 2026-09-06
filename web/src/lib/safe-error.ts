/** Safe error summary for logs. Never returns the raw pg/driver error object,
 *  whose `message` can embed the DATABASE_URL (including the password). Used by
 *  the realtime LISTEN client and the background poller's lock connection. */
export function errInfo(err: unknown): {message: string; code?: string} {
  if (err instanceof Error) {
    const code = (err as {code?: unknown}).code;
    return {message: err.message, code: typeof code === 'string' ? code : undefined};
  }
  return {message: String(err)};
}
