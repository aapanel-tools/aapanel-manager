import {createHash} from 'node:crypto';

const md5 = (input: string): string => createHash('md5').update(input).digest('hex');

export interface SignedAuth {
  request_time: string;
  request_token: string;
}

/**
 * aaPanel api_sk signature: request_token = md5(request_time + md5(api_sk)).
 * `requestTime` is UNIX seconds. Pass it in so the function stays pure/testable.
 */
export function sign(apiSk: string, requestTime: number): SignedAuth {
  const rt = String(requestTime);
  return {request_time: rt, request_token: md5(rt + md5(apiSk))};
}
