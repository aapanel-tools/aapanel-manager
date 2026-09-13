import {describe, it, expect} from 'vitest';
import {FILE_VIEW_MAX_BYTES, FILE_VIEW_MAX_RESPONSE_BYTES, looksBinary} from './viewing';

describe('the response cap for file contents', () => {
  /** The panel's own escaping, when it escapes everything outside ASCII (Python's default). */
  function asciiOnlyJson(value: unknown): string {
    return JSON.stringify(value).replace(
      /[\u007f-\uffff]/g,
      (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
  }

  const envelope = (data: string) => ({
    status: 0,
    message: {only_read: false, size: FILE_VIEW_MAX_BYTES, encoding: 'utf-8', data, historys: [], st_mtime: '1780896861'},
  });

  it('fits a file at the limit made entirely of control bytes', () => {
    const body = asciiOnlyJson(envelope('\u0001'.repeat(FILE_VIEW_MAX_BYTES)));
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(FILE_VIEW_MAX_RESPONSE_BYTES);
  });

  it('fits a file at the limit made entirely of undecodable bytes', () => {
    // One invalid byte in, one replacement character out, six bytes on the wire.
    const body = asciiOnlyJson(envelope('\ufffd'.repeat(FILE_VIEW_MAX_BYTES)));
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(FILE_VIEW_MAX_RESPONSE_BYTES);
  });

  it('fits a Cyrillic file at the limit, escaped or not', () => {
    const text = 'я'.repeat(FILE_VIEW_MAX_BYTES / 2); // two bytes each in UTF-8
    expect(Buffer.byteLength(asciiOnlyJson(envelope(text)))).toBeLessThanOrEqual(
      FILE_VIEW_MAX_RESPONSE_BYTES,
    );
    expect(Buffer.byteLength(JSON.stringify(envelope(text)))).toBeLessThanOrEqual(
      FILE_VIEW_MAX_RESPONSE_BYTES,
    );
  });

  it('stays under the transport ceiling every other answer lives with', () => {
    expect(FILE_VIEW_MAX_RESPONSE_BYTES).toBeLessThan(8 * 1024 * 1024);
  });
});

describe('looksBinary', () => {
  it('reads configuration and logs as text', () => {
    expect(looksBinary("<?php\ndefine('DB_NAME', 'wp');\r\n\tdefine('DB_HOST', 'localhost');\n")).toBe(false);
    expect(looksBinary('APP_KEY=base64:abc\nDB_PASSWORD=secret\n')).toBe(false);
    expect(looksBinary('\u001b[32mINFO\u001b[0m server started\n')).toBe(false);
    expect(looksBinary('Привет, мир! Это русский текст.\n')).toBe(false);
    expect(looksBinary('')).toBe(false);
  });

  it('treats a NUL anywhere as binary, however late it appears', () => {
    expect(looksBinary(`${'a'.repeat(100_000)}\u0000`)).toBe(true);
  });

  it('treats undecodable bytes as binary', () => {
    expect(looksBinary('\u0089PNG\r\n\u001a\n\ufffd\ufffd\ufffd\ufffd IHDR')).toBe(true);
  });

  it('treats what a Latin-1 decoder makes of random bytes as binary', () => {
    const noise = Array.from({length: 200}, (_, i) => String.fromCharCode(0x80 + (i % 32))).join('');
    expect(looksBinary(noise)).toBe(true);
  });

  it('tolerates the odd replacement character in otherwise ordinary text', () => {
    expect(looksBinary(`${'normal text '.repeat(50)}\ufffd`)).toBe(false);
  });
});
