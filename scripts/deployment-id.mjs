// The build's own identity, for Next's version-skew protection (ADR-0011).
//
// `next build` bakes NEXT_DEPLOYMENT_ID into what it builds, and `next start`
// has to run with the same value, or the server and the pages it serves
// disagree about which build they are. None of the ways this app is deployed
// provided such a value: .next/BUILD_ID turns constant once a deployment id is
// set, a value computed in next.config.ts differs between build and start, and
// a git update inherits the running server's id through its environment.
//
// So the build makes one, hands it to `next build` over whatever the
// environment holds, and writes it into .next/ once the build succeeds. .next
// ships in every artefact — the Docker image, the release bundle, the in-place
// git build — and `start` reads it back from there.

import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';

/** Where a finished build keeps its id: inside the output every artefact ships. */
export const DEPLOYMENT_ID_FILE = path.join('.next', 'DEPLOYMENT_ID');

/** The characters Next accepts (next/dist/build/index.js), at a length a header carries comfortably. */
const VALID = /^[A-Za-z0-9_-]{1,96}$/;

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isDeploymentId(value) {
  return typeof value === 'string' && VALID.test(value);
}

/**
 * `<version>-<UTC time to the second>-<random>`: readable in a header or a
 * support request, and different for two builds of one version made in the
 * same second.
 *
 * @param {string | undefined} version
 * @param {Date} [now]
 * @param {string} [random]
 * @returns {string}
 */
export function makeDeploymentId(version, now = new Date(), random = randomBytes(4).toString('hex')) {
  const safeVersion =
    String(version ?? '')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'unversioned';
  const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14);
  const id = `${safeVersion}-${stamp}-${random}`;
  if (!isDeploymentId(id)) {
    throw new Error(`Refusing to build with an invalid deployment id: ${JSON.stringify(id)}`);
  }
  return id;
}

/**
 * The id a finished build left in `dir`.
 *
 * `missing` is a build made without the wrapper — or a development tree — and
 * `invalid` a file that does not hold an id; either way there is no id to run
 * with, and the caller decides how loudly to say so.
 *
 * @param {string} dir
 * @returns {{id: string, problem: null} | {id: null, problem: 'missing' | 'invalid'}}
 */
export function readDeploymentId(dir) {
  let raw;
  try {
    raw = readFileSync(path.join(dir, DEPLOYMENT_ID_FILE), 'utf8');
  } catch {
    return {id: null, problem: 'missing'};
  }
  const id = raw.trim();
  return isDeploymentId(id) ? {id, problem: null} : {id: null, problem: 'invalid'};
}
