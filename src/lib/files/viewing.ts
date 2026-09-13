/**
 * What this app agrees to show of a file's contents (ADR-0008).
 *
 * Pure and shared: the browser uses the limit to decide whether to offer
 * "open" at all, and the server enforces it again, because the size in a
 * directory listing is a snapshot and a log file keeps growing after it.
 */

/**
 * Largest file opened for viewing: 1 MiB.
 *
 * The files people open a panel's file manager for — a site's configuration,
 * an `.env`, an nginx vhost — are three orders of magnitude below this. Past it
 * the file is a log or a dump, and a scrolling block of text in a browser tab is
 * the wrong tool for either.
 */
export const FILE_VIEW_MAX_BYTES = 1024 * 1024;

/**
 * Largest panel answer read for one file's contents.
 *
 * The contents arrive escaped inside JSON, and escaping grows them: a control
 * byte becomes `\u0001`, and a panel that escapes everything outside ASCII turns
 * one invalid byte into `\ufffd` — six bytes out for one in, the worst case.
 * Six times the file limit therefore always fits a file at the limit, with room
 * for the envelope, and an answer that overflows it belongs to a file that is
 * certainly over the limit. That is what lets the client report "too large"
 * rather than a panel failure when the cap is hit.
 */
export const FILE_VIEW_MAX_RESPONSE_BYTES = 6 * FILE_VIEW_MAX_BYTES + 64 * 1024;

/** How much of the text is inspected. Binary formats give themselves away in their header. */
const SAMPLE_CHARS = 8192;

/** Share of suspicious characters above which text is treated as binary. */
const SUSPICIOUS_SHARE = 0.1;

/**
 * Control characters that ordinary text does contain: tab, line feed, vertical
 * tab, form feed, carriage return, backspace — and escape, because log files
 * are full of terminal colour codes.
 */
const TEXT_CONTROLS: ReadonlySet<number> = new Set([0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1b]);

/**
 * Whether the panel's decoded text is really a binary file.
 *
 * Judged by content, not by extension: `.log` can be binary and `.dat` can be
 * text, and an extension list is a guess about someone else's naming habits.
 *
 * A NUL anywhere settles it — text files do not carry one. Otherwise the first
 * few thousand characters are counted: the replacement character (what a
 * decoder leaves in place of bytes it could not read), C0 controls that text
 * does not use, and C1 controls (what a Latin-1 decoder makes of arbitrary high
 * bytes). More than one in ten, and showing it as text would show noise.
 */
export function looksBinary(text: string): boolean {
  if (text.includes('\u0000')) return true;

  let seen = 0;
  let suspicious = 0;
  for (const ch of text) {
    if (seen === SAMPLE_CHARS) break;
    seen += 1;
    const code = ch.codePointAt(0) ?? 0;
    if (
      code === 0xfffd ||
      (code < 0x20 && !TEXT_CONTROLS.has(code)) ||
      (code >= 0x7f && code <= 0x9f)
    ) {
      suspicious += 1;
    }
  }
  return seen > 0 && suspicious / seen > SUSPICIOUS_SHARE;
}
