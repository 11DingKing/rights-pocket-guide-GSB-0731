/**
 * Shared test fixtures: a signed manifest + packs generated with an in-test
 * Ed25519 keypair, so every test verifies against a consistent public key. Uses
 * Node's crypto to sign exactly the way scripts/build-manifest.mjs does.
 */
import { createHash, generateKeyPairSync, sign as edSign } from 'node:crypto';
import v1 from '../../materials/content-pack-v1.json';
import v2 from '../../materials/content-pack-v2.json';

export const v1Text = JSON.stringify(v1);
export const v2Text = JSON.stringify(v2);

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
export const publicKeyBase64 = publicKey
  .export({ type: 'spki', format: 'der' })
  .toString('base64');

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sign(text: string): string {
  return edSign(null, Buffer.from(text, 'utf8'), privateKey).toString('base64');
}

export const packTexts: Record<string, string> = {
  'content-pack-v1.json': v1Text,
  'content-pack-v2.json': v2Text,
};

interface ManifestOptions {
  readonly latest?: string;
  readonly includeV2?: boolean;
  readonly publicKey?: string;
}

/** Build a valid signed manifest (both versions by default). */
export function makeManifest(options: ManifestOptions = {}): string {
  const includeV2 = options.includeV2 ?? true;
  const packages = [
    {
      packageVersion: '2026.07.31',
      url: 'materials/content-pack-v1.json',
      sha256: sha256(v1Text),
      signature: sign(v1Text),
      kind: 'full',
    },
    ...(includeV2
      ? [
          {
            packageVersion: '2026.09.01',
            url: 'materials/content-pack-v2.json',
            sha256: sha256(v2Text),
            signature: sign(v2Text),
            kind: 'delta',
            succeeds: '2026.07.31',
          },
        ]
      : []),
  ];
  return JSON.stringify({
    latest: options.latest ?? (includeV2 ? '2026.09.01' : '2026.07.31'),
    publicKey: options.publicKey ?? publicKeyBase64,
    packages,
  });
}

export const manifestText = makeManifest();
export const baseOnlyManifestText = makeManifest({ includeV2: false });
