import {describe, it, expect} from 'vitest';
import {isOtherBuild} from './use-build-watch';

describe('isOtherBuild', () => {
  const tab = '0_7_0-20260914120000-a1b2c3d4';

  it('says so when the server runs another build', () => {
    expect(isOtherBuild(tab, {ok: true, deploymentId: '0_7_0-20260914130000-e5f6a7b8'})).toBe(true);
  });

  it('is quiet when the server runs this build', () => {
    expect(isOtherBuild(tab, {ok: true, deploymentId: tab})).toBe(false);
  });

  it('is quiet when either side has no build id — that says nothing about skew', () => {
    expect(isOtherBuild(undefined, {deploymentId: 'x'})).toBe(false);
    expect(isOtherBuild('', {deploymentId: 'x'})).toBe(false);
    expect(isOtherBuild(tab, {ok: true, deploymentId: null})).toBe(false);
    expect(isOtherBuild(tab, {ok: true})).toBe(false);
    expect(isOtherBuild(tab, {deploymentId: ''})).toBe(false);
  });

  it('is quiet on an answer that is not shaped like one', () => {
    expect(isOtherBuild(tab, null)).toBe(false);
    expect(isOtherBuild(tab, 'up')).toBe(false);
    expect(isOtherBuild(tab, {deploymentId: 42})).toBe(false);
  });
});
