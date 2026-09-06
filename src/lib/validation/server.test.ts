import {describe, it, expect} from 'vitest';
import {serverCreateSchema, serverListParamsSchema} from './server';

describe('serverCreateSchema', () => {
  it('accepts a valid server and keeps the TLS mode', () => {
    const r = serverCreateSchema.safeParse({
      name: 'Prod-1', baseUrl: 'https://1.2.3.4:8888', apiSk: 'x'.repeat(16), tag: 'eu', tlsMode: 'PINNED',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tlsMode).toBe('PINNED');
  });

  it('defaults to PINNED when the mode is absent or blank', () => {
    const explicit = serverCreateSchema.safeParse({name: 'a', baseUrl: 'http://h:1', apiSk: 'x'.repeat(16), tlsMode: 'VERIFY'});
    expect(explicit.success && explicit.data.tlsMode).toBe('VERIFY');
    const absent = serverCreateSchema.safeParse({name: 'a', baseUrl: 'http://h:1', apiSk: 'x'.repeat(16)});
    expect(absent.success && absent.data.tlsMode).toBe('PINNED');
  });

  // There is deliberately no value that means "do not check" (ADR-0002).
  it('rejects an unknown TLS mode', () => {
    const r = serverCreateSchema.safeParse({
      name: 'a', baseUrl: 'https://h:1', apiSk: 'x'.repeat(16), tlsMode: 'INSECURE',
    });
    expect(r.success).toBe(false);
  });

  it('normalizes a pasted fingerprint and rejects a truncated one', () => {
    const ok = serverCreateSchema.safeParse({
      name: 'a', baseUrl: 'https://h:1', apiSk: 'x'.repeat(16),
      tlsPinSha256: 'aa:bb:' + 'cc:'.repeat(29) + 'dd',
    });
    expect(ok.success && ok.data.tlsPinSha256).toBe(('AABB' + 'CC'.repeat(29) + 'DD'));
    const short = serverCreateSchema.safeParse({
      name: 'a', baseUrl: 'https://h:1', apiSk: 'x'.repeat(16), tlsPinSha256: 'AABBCC',
    });
    expect(short.success).toBe(false);
  });

  it('rejects non-http(s) URLs and short api_sk', () => {
    expect(serverCreateSchema.safeParse({name: 'a', baseUrl: 'ftp://x', apiSk: 'x'.repeat(16)}).success).toBe(false);
    expect(serverCreateSchema.safeParse({name: 'a', baseUrl: 'https://x:1', apiSk: 'short'}).success).toBe(false);
  });

  it('coerces empty tag to undefined', () => {
    const r = serverCreateSchema.safeParse({name: 'a', baseUrl: 'http://h:1', apiSk: 'x'.repeat(16), tag: ''});
    expect(r.success && r.data.tag).toBeUndefined();
  });
});

describe('serverListParamsSchema (resilient to hand-edited URLs — never throws)', () => {
  it('applies defaults on empty input', () => {
    const r = serverListParamsSchema.parse({});
    expect(r).toMatchObject({page: 1, pageSize: 25, status: 'all', sort: 'name', dir: 'asc'});
  });
  it('clamps oversized pageSize to 100', () => {
    expect(serverListParamsSchema.parse({pageSize: '999'}).pageSize).toBe(100);
  });
  it('falls back invalid enum values to defaults instead of throwing', () => {
    expect(serverListParamsSchema.parse({sort: 'pwned'}).sort).toBe('name');
    expect(serverListParamsSchema.parse({status: 'nope', dir: 'sideways'})).toMatchObject({status: 'all', dir: 'asc'});
  });
  it('tolerates duplicated params (array values) by taking the first', () => {
    expect(serverListParamsSchema.parse({status: ['online', 'offline']}).status).toBe('online');
  });
});
