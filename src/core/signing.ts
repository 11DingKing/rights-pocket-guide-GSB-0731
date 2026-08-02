/**
 * Package signature verification. Each package's bytes are signed (Ed25519)
 * with a private key held only at build time; the corresponding public key is
 * pinned into the app (bundled seed + optionally the manifest is fetched over
 * the same origin). A downloaded pack is accepted only if BOTH its sha256
 * matches the manifest AND its signature verifies against the pinned key.
 *
 * Verification is layered on top of, not instead of, the sha256 check: the hash
 * catches corruption/truncation, the signature catches tampering by anyone who
 * could also rewrite the manifest hash. A failed signature is treated exactly
 * like a failed download — nothing is staged or committed.
 *
 * The public key is distributed as base64-encoded SPKI DER so it is a plain
 * JSON string with no binary handling in the manifest.
 */

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class SignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignatureError';
  }
}

const ALGORITHM = { name: 'Ed25519' } as const;

/** Import a base64 SPKI Ed25519 public key for verification. */
export async function importVerifyKey(spkiBase64: string): Promise<CryptoKey> {
  const spki = base64ToBytes(spkiBase64);
  try {
    return await crypto.subtle.importKey(
      'spki',
      spki,
      ALGORITHM,
      false,
      ['verify'],
    );
  } catch (cause) {
    throw new SignatureError(
      `Failed to import public key: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

/**
 * Verify that `signatureBase64` is a valid Ed25519 signature over the UTF-8
 * bytes of `text` for the given key. Returns a boolean; never throws on a
 * simple mismatch so callers can decide how to surface it.
 */
export async function verifySignature(
  key: CryptoKey,
  text: string,
  signatureBase64: string,
): Promise<boolean> {
  let signature: Uint8Array;
  try {
    signature = base64ToBytes(signatureBase64);
  } catch {
    return false;
  }
  const data = new TextEncoder().encode(text);
  try {
    return await crypto.subtle.verify(ALGORITHM, key, signature, data);
  } catch {
    return false;
  }
}
