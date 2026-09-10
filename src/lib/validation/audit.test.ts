import {describe, it, expect} from 'vitest';
import {auditListParamsSchema} from './audit';

// These params come straight from the URL, where anything can appear. The schema
// must never throw: a broken link should show the journal, not an error page.
describe('auditListParamsSchema', () => {
  it('fills in defaults for an empty query', () => {
    const p = auditListParamsSchema.parse({});
    expect(p).toMatchObject({page: 1, pageSize: 50, result: 'all'});
    expect(p.q).toBeUndefined();
    expect(p.from).toBeUndefined();
    expect(p.to).toBeUndefined();
  });

  it('survives garbage in every field', () => {
    const p = auditListParamsSchema.parse({
      page: 'not-a-number',
      pageSize: {},
      result: 'whatever',
      from: 'yesterday',
      to: '',
    });
    expect(p).toMatchObject({page: 1, pageSize: 50, result: 'all'});
    expect(p.from).toBeUndefined();
    expect(p.to).toBeUndefined();
  });

  it('accepts the forensic result filter and still refuses nonsense', () => {
    // 'started' is a real stored value, so it has to survive the URL; anything
    // outside the vocabulary must fall back to showing everything rather than
    // filtering the journal down to nothing.
    expect(auditListParamsSchema.parse({result: 'started'}).result).toBe('started');
    expect(auditListParamsSchema.parse({result: 'STARTED'}).result).toBe('all');
    expect(auditListParamsSchema.parse({result: 'failed'}).result).toBe('all');
  });

  it('clamps the page size to a sane window', () => {
    expect(auditListParamsSchema.parse({pageSize: '1'}).pageSize).toBe(10);
    expect(auditListParamsSchema.parse({pageSize: '10000'}).pageSize).toBe(200);
  });

  it('takes the first value when a param is repeated', () => {
    const p = auditListParamsSchema.parse({result: ['error', 'ok'], page: ['3', '9']});
    expect(p.result).toBe('error');
    expect(p.page).toBe(3);
  });

  it('parses an ISO date bound', () => {
    const p = auditListParamsSchema.parse({from: '2026-01-15', to: '2026-02-20'});
    expect(p.from?.toISOString().slice(0, 10)).toBe('2026-01-15');
    expect(p.to?.toISOString().slice(0, 10)).toBe('2026-02-20');
  });
});
