// AES-256-GCM encryption for exchange API credentials at rest.
//
// Key source, in order of preference:
//   1. ARB_ENCRYPTION_KEY env var (64 hex chars = 32 bytes)
//   2. Auto-generated key persisted to .arb-secret next to the database
//      (gitignored, chmod 600) so a stolen DB file alone is useless.
//      Lives in the DATABASE_PATH directory when set (Docker volume),
//      otherwise in the project directory.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const dataDir = process.env.DATABASE_PATH
  ? path.dirname(process.env.DATABASE_PATH)
  : process.cwd();
const KEY_FILE = process.env.ARB_KEY_FILE || path.join(dataDir, '.arb-secret');

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const envKey = process.env.ARB_ENCRYPTION_KEY;
  if (envKey) {
    if (!/^[0-9a-fA-F]{64}$/.test(envKey)) {
      throw new Error('ARB_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }
    cachedKey = Buffer.from(envKey, 'hex');
    return cachedKey;
  }

  if (fs.existsSync(KEY_FILE)) {
    const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (/^[0-9a-fA-F]{64}$/.test(hex)) {
      cachedKey = Buffer.from(hex, 'hex');
      return cachedKey;
    }
    throw new Error(`.arb-secret exists but is not a valid 64-char hex key`);
  }

  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString('hex') + '\n', { mode: 0o600 });
  console.log('[arbitrage] Generated new credential encryption key at .arb-secret');
  cachedKey = key;
  return key;
}

/** Encrypt a string; output format: iv.ciphertext.authTag (base64, dot-separated). */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${enc.toString('base64')}.${tag.toString('base64')}`;
}

export function decrypt(payload: string): string {
  const [ivB64, dataB64, tagB64] = payload.split('.');
  if (!ivB64 || !dataB64 || !tagB64) throw new Error('Invalid encrypted payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
