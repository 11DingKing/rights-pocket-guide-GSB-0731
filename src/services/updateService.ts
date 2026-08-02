/**
 * Update service — the orchestration layer that owns the whole offline update
 * pipeline and guarantees atomicity. Views and the repository call into this;
 * they never see IndexedDB, fetch, parsing, or indexing directly.
 *
 * Pipeline for reaching a target version:
 *   1. download   — fetch every pack in the chain (full base + deltas)
 *   2. verify      — sha256 each pack against the manifest; mismatch aborts
 *   3. parse       — validate JSON structure
 *   4. resolve     — fold the chain into one snapshot
 *   5. index       — build the deterministic search index
 *   6. commit      — write snapshot+index AND advance the active pointer in a
 *                    single IndexedDB transaction (atomic)
 *
 * If any step 1–5 fails, nothing is written and the previously active version
 * stays fully usable. If step 6 aborts (e.g. quota), the transaction rolls back
 * and the pointer still names the old complete version. Either way a restart
 * shows a complete old package or a complete new package, never a mix.
 *
 * A `stageHook` lets tests inject a failure at any stage and simulate quota.
 */
import { buildIndex } from '../core/search/index';
import { constantTimeEquals, sha256Hex } from '../core/checksum';
import { parsePackageText } from '../core/parse';
import { resolveChain } from '../core/resolve';
import type { ParsedPackage, StoredPackage } from '../core/types';
import type { PackageStore } from '../storage/packageStore';
import type { TextFetcher } from './fetcher';
import { chainTo, parseManifestText, type Manifest } from './manifest';

export type UpdateStage =
  | 'download'
  | 'verify'
  | 'parse'
  | 'resolve'
  | 'index'
  | 'commit';

export class UpdateError extends Error {
  constructor(
    message: string,
    readonly stage: UpdateStage,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'UpdateError';
  }
}

export interface UpdateResult {
  readonly switched: boolean;
  readonly activeVersion: string;
  readonly attemptedVersion: string;
}

/** Optional hook fired at the start of each stage (tests inject failures). */
export type StageHook = (stage: UpdateStage) => void | Promise<void>;

export interface UpdateDeps {
  readonly store: PackageStore;
  readonly fetcher: TextFetcher;
  readonly manifestUrl: string;
  readonly stageHook?: StageHook;
}

async function runStage(
  hook: StageHook | undefined,
  stage: UpdateStage,
): Promise<void> {
  if (hook !== undefined) {
    try {
      await hook(stage);
    } catch (cause) {
      throw new UpdateError(
        `Interrupted at ${stage}`,
        stage,
        cause,
      );
    }
  }
}

export async function fetchManifest(deps: UpdateDeps): Promise<Manifest> {
  const text = await deps.fetcher.fetchText(deps.manifestUrl);
  return parseManifestText(text);
}

/**
 * Attempt to switch to `targetVersion`. Returns the version that is active
 * *after* the attempt. On failure the active version is unchanged and the
 * thrown error names the failing stage.
 */
export async function updateTo(
  deps: UpdateDeps,
  manifest: Manifest,
  targetVersion: string,
): Promise<UpdateResult> {
  const previousActive = await deps.store.getActiveVersion();

  // Already at target: nothing to do.
  if (previousActive === targetVersion) {
    return {
      switched: false,
      activeVersion: targetVersion,
      attemptedVersion: targetVersion,
    };
  }

  const chain = chainTo(manifest, targetVersion);

  // 1. download
  await runStage(deps.stageHook, 'download');
  const downloaded: Array<{ text: string; sha256: string }> = [];
  for (const entry of chain) {
    let text: string;
    try {
      text = await deps.fetcher.fetchText(entry.url);
    } catch (cause) {
      throw new UpdateError(
        `Download failed for ${entry.packageVersion}`,
        'download',
        cause,
      );
    }
    downloaded.push({ text, sha256: entry.sha256 });
  }

  // 2. verify checksums
  await runStage(deps.stageHook, 'verify');
  for (let i = 0; i < chain.length; i += 1) {
    const item = downloaded[i];
    const entry = chain[i];
    if (item === undefined || entry === undefined) {
      throw new UpdateError('Internal chain mismatch', 'verify');
    }
    const actual = await sha256Hex(item.text);
    if (!constantTimeEquals(actual, entry.sha256)) {
      throw new UpdateError(
        `Checksum mismatch for ${entry.packageVersion}`,
        'verify',
      );
    }
  }

  // 3. parse
  await runStage(deps.stageHook, 'parse');
  const parsed: ParsedPackage[] = [];
  try {
    for (const item of downloaded) {
      parsed.push(parsePackageText(item.text));
    }
  } catch (cause) {
    throw new UpdateError('Failed to parse package', 'parse', cause);
  }

  // 4. resolve
  await runStage(deps.stageHook, 'resolve');
  let snapshot;
  try {
    snapshot = resolveChain(parsed);
  } catch (cause) {
    throw new UpdateError('Failed to resolve package chain', 'resolve', cause);
  }

  // 5. index
  await runStage(deps.stageHook, 'index');
  let index;
  try {
    index = buildIndex(snapshot);
  } catch (cause) {
    throw new UpdateError('Failed to build search index', 'index', cause);
  }

  const targetEntry = chain[chain.length - 1];
  if (targetEntry === undefined) {
    throw new UpdateError('Empty chain', 'resolve');
  }
  const stored: StoredPackage = {
    packageVersion: snapshot.packageVersion,
    kind: targetEntry.kind,
    ...(targetEntry.succeeds === undefined
      ? {}
      : { succeeds: targetEntry.succeeds }),
    snapshot,
    index,
  };

  // 6. commit — atomic single transaction. Quota/interruption here rolls back.
  await runStage(deps.stageHook, 'commit');
  try {
    await deps.store.commitActivePackage(stored);
  } catch (cause) {
    throw new UpdateError('Atomic commit failed', 'commit', cause);
  }

  return {
    switched: true,
    activeVersion: snapshot.packageVersion,
    attemptedVersion: targetVersion,
  };
}

/**
 * Ensure the app has a usable active package, then try to advance to the
 * manifest's latest. Guarantees:
 *  - If nothing is installed yet, install the *base full* package first so the
 *    user always has a complete package even if the delta update later fails.
 *  - Then attempt latest; on failure keep the complete current version.
 */
export async function ensureUpToDate(
  deps: UpdateDeps,
): Promise<UpdateResult & { readonly updateError?: UpdateError }> {
  const manifest = await fetchManifest(deps);
  const active = await deps.store.getActiveVersion();

  // Bootstrap: if there is no active package, install the earliest full base.
  if (active === undefined) {
    const base = manifest.packages.find((p) => p.kind === 'full');
    if (base === undefined) {
      throw new UpdateError('Manifest has no full base package', 'resolve');
    }
    await updateTo(deps, manifest, base.packageVersion);
  }

  try {
    const result = await updateTo(deps, manifest, manifest.latest);
    return result;
  } catch (cause) {
    // Update to latest failed — keep the complete current version.
    const current = await deps.store.getActiveVersion();
    const updateError =
      cause instanceof UpdateError
        ? cause
        : new UpdateError(String(cause), 'download', cause);
    return {
      switched: false,
      activeVersion: current ?? manifest.latest,
      attemptedVersion: manifest.latest,
      updateError,
    };
  }
}
