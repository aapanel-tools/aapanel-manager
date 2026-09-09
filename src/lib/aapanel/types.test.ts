import {describe, it, expect} from 'vitest';

import {AaPanelError, describeError, describeSourceFailure} from './types';

describe('describeError', () => {
  // Д-4: on a fleet, a failure that does not say whose panel failed is not
  // actionable — the operator has to open every server to find out.
  it('names the server it is talking about', () => {
    const err = new AaPanelError('tls_pin_mismatch', 'fingerprint changed');
    expect(describeError(err, 'prod-web-01')).toBe(
      'prod-web-01: panel presented a different TLS certificate — fingerprint changed',
    );
  });

  it('omits the prefix when there is no server to name', () => {
    // Testing a connection to a panel that has not been saved yet: there is no
    // name, and inventing one would be worse than leaving it out.
    const err = new AaPanelError('auth', 'invalid api_sk');
    expect(describeError(err)).toBe('panel rejected the API key — invalid api_sk');
  });

  it('turns the error kind into a phrase instead of leaking the enum name', () => {
    expect(describeError(new AaPanelError('network', ''))).toBe('panel unreachable');
    expect(describeError(new AaPanelError('timeout', ''))).toBe('panel did not answer in time');
  });

  it("keeps the panel's own wording, which is the part worth reading", () => {
    const err = new AaPanelError('panel_error', 'The specified project does not exist');
    expect(describeError(err, 'srv')).toContain('The specified project does not exist');
  });

  it('does not repeat itself when the panel said nothing beyond the kind', () => {
    const err = new AaPanelError('panel_error', 'panel refused the request');
    expect(describeError(err, 'srv')).toBe('srv: panel refused the request');
  });

  it('handles a plain Error and a non-Error throw', () => {
    expect(describeError(new Error('socket hang up'), 'srv')).toBe('srv: socket hang up');
    expect(describeError('boom', 'srv')).toBe('srv: Unknown error');
    expect(describeError(undefined)).toBe('Unknown error');
  });
});

describe('describeSourceFailure', () => {
  it('keeps the failing source and the panel kind', () => {
    const err = new AaPanelError('timeout', 'took too long');
    expect(describeSourceFailure('mysql', err)).toEqual({
      source: 'mysql',
      kind: 'timeout',
      message: 'took too long',
    });
  });

  it('files anything that is not an AaPanelError under panel_error', () => {
    expect(describeSourceFailure('pgsql', new Error('boom'))).toEqual({
      source: 'pgsql',
      kind: 'panel_error',
      message: 'boom',
    });
  });
});
