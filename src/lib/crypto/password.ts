import {hash, verify} from '@node-rs/argon2';

export function hashPassword(plain: string): Promise<string> {
  return hash(plain); // argon2id by default
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
