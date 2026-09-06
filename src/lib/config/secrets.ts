import 'server-only';

/** Reads and validates the AES key. Throws (never returns an invalid key). */
export function getEncryptionKey(): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('APP_ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
  }
  return key;
}
