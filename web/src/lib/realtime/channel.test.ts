import {describe, it, expect} from 'vitest';
import {SERVER_EVENTS_CHANNEL, parseServerEvent} from './channel';

describe('parseServerEvent', () => {
  it('parses a valid payload', () => {
    expect(parseServerEvent(JSON.stringify({serverId: 'abc', online: true}))).toEqual({serverId: 'abc', online: true});
  });
  it('returns null for malformed payloads', () => {
    expect(parseServerEvent('not json')).toBeNull();
    expect(parseServerEvent(JSON.stringify({nope: 1}))).toBeNull();
    expect(parseServerEvent(JSON.stringify({serverId: 1, online: 'yes'}))).toBeNull();
  });
  it('exposes a stable channel name', () => {
    expect(SERVER_EVENTS_CHANNEL).toBe('servers_status');
  });
});
