import {randomBytes, createCipheriv, createDecipheriv} from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function keyToBuffer(hexKey: string): Buffer {
  const buf = Buffer.from(hexKey, 'hex');
  if (buf.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  return buf;
}

/** Returns base64 of iv(12) || tag(16) || ciphertext. */
export function encryptSecret(plain: string, hexKey: string): string {
  const key = keyToBuffer(hexKey);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(payloadB64: string, hexKey: string): string {
  const key = keyToBuffer(hexKey);
  const data = Buffer.from(payloadB64, 'base64');
  const iv = data.subarray(0, IV_LEN);
  const tag = data.subarray(IV_LEN, IV_LEN + 16);
  const ct = data.subarray(IV_LEN + 16);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
