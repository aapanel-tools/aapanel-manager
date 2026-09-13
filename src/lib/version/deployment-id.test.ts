import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, it, expect} from 'vitest';
import {
  DEPLOYMENT_ID_FILE,
  isDeploymentId,
  makeDeploymentId,
  readDeploymentId,
} from '../../../scripts/deployment-id.mjs';

/**
 * The build's id is made by scripts/run-next.mjs, so the rules live in a plain
 * module next to it and are tested from here (ADR-0011).
 */
describe('makeDeploymentId', () => {
  const NOW = new Date('2026-09-14T12:34:56.789Z');

  it('reads as version, UTC time and a random tail, in the characters Next accepts', () => {
    const id = makeDeploymentId('0.7.0', NOW, 'a1b2c3d4');
    expect(id).toBe('0_7_0-20260914123456-a1b2c3d4');
    expect(isDeploymentId(id)).toBe(true);
  });

  it('differs for two builds of one version made in the same second', () => {
    expect(makeDeploymentId('0.7.0', NOW)).not.toBe(makeDeploymentId('0.7.0', NOW));
  });

  it('turns any version into allowed characters, and names a missing one', () => {
    expect(makeDeploymentId('1.2.3-beta.1+build.5', NOW, 'ff')).toBe('1_2_3_beta_1_build_5-20260914123456-ff');
    expect(makeDeploymentId(undefined, NOW, 'ff')).toBe('unversioned-20260914123456-ff');
    expect(makeDeploymentId('...', NOW, 'ff')).toBe('unversioned-20260914123456-ff');
  });
});

describe('isDeploymentId', () => {
  it('accepts only what Next accepts', () => {
    expect(isDeploymentId('0_7_0-20260914123456-a1b2c3d4')).toBe(true);
    for (const bad of ['', 'has space', 'dot.in.it', 'slash/in', 'x'.repeat(97), 42, null]) {
      expect(isDeploymentId(bad)).toBe(false);
    }
  });
});

describe('readDeploymentId', () => {
  const dirs: string[] = [];
  const appDir = (): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dpl-'));
    dirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true});
  });

  it('reads the id a finished build left behind', () => {
    const dir = appDir();
    mkdirSync(path.join(dir, '.next'));
    writeFileSync(path.join(dir, DEPLOYMENT_ID_FILE), '0_7_0-20260914123456-a1b2c3d4\n');
    expect(readDeploymentId(dir)).toEqual({id: '0_7_0-20260914123456-a1b2c3d4', problem: null});
  });

  it('reports a build made without the wrapper as missing', () => {
    expect(readDeploymentId(appDir())).toEqual({id: null, problem: 'missing'});
  });

  it('refuses a file that does not hold an id', () => {
    const dir = appDir();
    mkdirSync(path.join(dir, '.next'));
    writeFileSync(path.join(dir, DEPLOYMENT_ID_FILE), 'not an id; rm -rf /\n');
    expect(readDeploymentId(dir)).toEqual({id: null, problem: 'invalid'});
  });
});
