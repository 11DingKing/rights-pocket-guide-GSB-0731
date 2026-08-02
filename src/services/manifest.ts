/**
 * Manifest parsing. The manifest is the trusted index of available package
 * versions and their sha256 checksums. Like the pack parser, everything comes
 * in as `unknown` and is validated with explicit guards.
 */

export interface ManifestEntry {
  readonly packageVersion: string;
  readonly url: string;
  readonly sha256: string;
  readonly signature: string;
  readonly kind: 'full' | 'delta';
  readonly succeeds?: string;
}

export interface Manifest {
  readonly latest: string;
  readonly publicKey: string;
  readonly packages: readonly ManifestEntry[];
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ManifestError(`Expected non-empty string at ${path}`);
  }
  return value;
}

function parseEntry(value: unknown, path: string): ManifestEntry {
  if (!isRecord(value)) {
    throw new ManifestError(`Expected object at ${path}`);
  }
  const kind = str(value['kind'], `${path}.kind`);
  if (kind !== 'full' && kind !== 'delta') {
    throw new ManifestError(`Invalid kind "${kind}" at ${path}.kind`);
  }
  const succeeds = value['succeeds'];
  return {
    packageVersion: str(value['packageVersion'], `${path}.packageVersion`),
    url: str(value['url'], `${path}.url`),
    sha256: str(value['sha256'], `${path}.sha256`),
    signature: str(value['signature'], `${path}.signature`),
    kind,
    ...(succeeds === undefined
      ? {}
      : { succeeds: str(succeeds, `${path}.succeeds`) }),
  };
}

export function parseManifest(value: unknown): Manifest {
  if (!isRecord(value)) {
    throw new ManifestError('Manifest must be an object');
  }
  const packagesRaw = value['packages'];
  if (!Array.isArray(packagesRaw)) {
    throw new ManifestError('Manifest.packages must be an array');
  }
  const packages = packagesRaw.map((entry, i) =>
    parseEntry(entry, `packages[${i}]`),
  );
  return {
    latest: str(value['latest'], 'latest'),
    publicKey: str(value['publicKey'], 'publicKey'),
    packages,
  };
}

export function parseManifestText(text: string): Manifest {
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ManifestError(
      `Invalid manifest JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  return parseManifest(json);
}

/**
 * Build the ordered chain of manifest entries needed to reach `target`,
 * starting from a full package and following `succeeds` links forward.
 */
export function chainTo(
  manifest: Manifest,
  target: string,
): ManifestEntry[] {
  const byVersion = new Map<string, ManifestEntry>();
  for (const entry of manifest.packages) {
    byVersion.set(entry.packageVersion, entry);
  }
  const reversed: ManifestEntry[] = [];
  let cursor: string | undefined = target;
  const seen = new Set<string>();
  while (cursor !== undefined) {
    if (seen.has(cursor)) {
      throw new ManifestError(`Cyclic succeeds chain at "${cursor}"`);
    }
    seen.add(cursor);
    const entry = byVersion.get(cursor);
    if (entry === undefined) {
      throw new ManifestError(`Manifest is missing version "${cursor}"`);
    }
    reversed.push(entry);
    cursor = entry.kind === 'delta' ? entry.succeeds : undefined;
  }
  return reversed.reverse();
}
