import {describe, it, expect} from 'vitest';
import {createHash} from 'node:crypto';
import {sign} from './signing';

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

describe('sign', () => {
  it('builds request_token = md5(request_time + md5(api_sk)) for a fixed time', () => {
    const requestTime = 1_700_000_000;
    const apiSk = 'test_api_sk_value';
    const out = sign(apiSk, requestTime);
    expect(out.request_time).toBe(String(requestTime));
    expect(out.request_token).toBe(md5(String(requestTime) + md5(apiSk)));
  });

  it('is deterministic for the same inputs and changes with time', () => {
    expect(sign('k', 1).request_token).toBe(sign('k', 1).request_token);
    expect(sign('k', 1).request_token).not.toBe(sign('k', 2).request_token);
  });
});
