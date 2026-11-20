import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { isChannel, type Channel } from './codes.js';

/**
 * The licence token: `<base64url(payload JSON)>.<base64url(Ed25519 signature)>`, where the
 * signature covers the ASCII bytes of the first part. The game checks it offline with the public
 * key built into it (Release/Access/LicenceToken.cs reads the same format).
 */
export interface TokenPayload {
  /** Format version. */
  v: 1;
  /** Code id (a hash of the code, see codeIdOf); never the code itself. */
  cid: string;
  /** The code's channel. */
  ch: Channel;
  /** The game's random install id. */
  iid: string;
  /** The visible part of the code, e.g. `RB-7K3M`. */
  hint: string;
  /** Issued, Unix seconds. */
  iat: number;
  /** Expires, Unix seconds: the offline grace, or the code's own expiry when that is sooner. */
  exp: number;
}

/** How long a token works without checking back: the offline grace. */
export const GRACE_SECONDS = 30 * 24 * 60 * 60;

// DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows it.
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function encodeToken(payload: TokenPayload, privateKey: KeyObject): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = sign(null, Buffer.from(body, 'ascii'), privateKey).toString('base64url');
  return `${body}.${signature}`;
}

/**
 * Checks the signature and shape. Returns the payload, or null for anything wrong. Expiry is not
 * checked here: refresh accepts an expired token, because the table decides.
 */
export function decodeToken(token: unknown, publicKey: KeyObject): TokenPayload | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts as [string, string];
  let ok = false;
  try {
    ok = verify(null, Buffer.from(body, 'ascii'), publicKey, Buffer.from(signature, 'base64url'));
  } catch {
    return null;
  }
  if (!ok) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  return isPayload(parsed) ? parsed : null;
}

function isPayload(value: unknown): value is TokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record['v'] === 1 &&
    typeof record['cid'] === 'string' &&
    isChannel(record['ch']) &&
    typeof record['iid'] === 'string' &&
    typeof record['hint'] === 'string' &&
    typeof record['iat'] === 'number' &&
    typeof record['exp'] === 'number'
  );
}

/** A token's expiry: now plus the grace, but never past the code's own expiry. */
export function expiryFor(nowSeconds: number, codeExpiresSeconds: number | undefined): number {
  const grace = nowSeconds + GRACE_SECONDS;
  return codeExpiresSeconds === undefined ? grace : Math.min(grace, codeExpiresSeconds);
}

export interface KeyPair {
  /** PKCS#8 DER, base64: what goes into the SSM SecureString. */
  privateKeyPkcs8: string;
  /** The raw 32-byte public key, base64: what goes into the game. */
  publicKeyRaw: string;
}

export function generateKeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPkcs8: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKeyRaw: rawPublicKey(publicKey),
  };
}

export function privateKeyFrom(pkcs8Base64: string): KeyObject {
  return createPrivateKey({
    key: Buffer.from(pkcs8Base64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
}

export function publicKeyFrom(rawBase64: string): KeyObject {
  const raw = Buffer.from(rawBase64, 'base64');
  if (raw.length !== 32) throw new Error('An Ed25519 public key is 32 bytes.');
  return createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

export function rawPublicKey(publicKey: KeyObject): string {
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32).toString('base64');
}
