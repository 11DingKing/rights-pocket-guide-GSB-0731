/**
 * Update service — the orchestration layer that owns the whole offline update
 * pipeline and guarantees atomicity. Views and the repository call into this;
 * they never see IndexedDB, fetch, parsing, or indexing directly.
 *
 * Pipeline for reaching a target version:
 *   1. download   — fetch every pack in the chain (full base + deltas)
 *   2. verify      — sha256 each pack against the manifest; mismatch aborts
 *   3. signature   — Ed25519-verify each pack against the pinned public key
 *   4. parse       — validate JSON structure
 *   5. resolve     — fold the chain into one snapshot
 *   6. index       — build the deterministic search index
 *   7. stage       — write the snapshot+index into the isolated staging store
 *   8. commit      — promote staged → active via a compare-and-set switch
 *
 * If any step 1–7 fails, nothing visible is written and the previously active
 * version stays fully usable; any staged bytes remain in the isolated staging
 * store where search and deep links never look. The commit (step 8) is a
 * single IndexedDB transaction that compare-and-sets the active pointer, so if
 * two tabs race, only one promotes and the other aborts. Either way a restart
 * shows a complete old package or a complete new package, never a mix.
 *
 * A `stageHook` lets tests inject a failure at any stage and simulate quota.
 */
import { buildIndex } from '../core/search/index';
import { constantTimeEquals, sha256Hex } from '../core/checksum';
import { parsePackageText } from '../core/parse';
import { coerceSettings, migrateSettings, normalizeSchema } from '../core/readingSettings';
import { resolveChain } from '../core/resolve';
import { importVerifyKey, verifySignature } from '../core/signing';
import type { ParsedPackage, StoredPackage } from '../core/types';
import { DEFAULT_READING_SETTINGS, settingsSchemaForPackage } from '../core/types';
import {
  StalePromotionError,
  type PackageStore,
  type StoredSettings,
} from '../storage/packageStore';
import type { TextFetcher } from './fetcher';
import { chainTo, parseManifestText, type Manifest } from './manifest';

export type UpdateStage =
  | 'download'
  | 'verify'
  | 'signature'
  | 'parse'
  | 'resolve'
  | 'index'
  | 'stage'
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
  const downloaded: Array<{ text: string; sha256: string; signature: string }> =
    [];
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
    downloaded.push({ text, sha256: entry.sha256, signature: entry.signature });
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

  // 3. signature — Ed25519 against the pinned public key. A tampered pack that
  // also rewrote the sha256 is caught here; a bad signature is treated exactly
  // like a failed download and nothing is staged.
  await runStage(deps.stageHook, 'signature');
  let verifyKey: CryptoKey;
  try {
    verifyKey = await importVerifyKey(manifest.publicKey);
  } catch (cause) {
    throw new UpdateError('Invalid manifest public key', 'signature', cause);
  }
  for (let i = 0; i < chain.length; i += 1) {
    const item = downloaded[i];
    const entry = chain[i];
    if (item === undefined || entry === undefined) {
      throw new UpdateError('Internal chain mismatch', 'signature');
    }
    const ok = await verifySignature(verifyKey, item.text, item.signature);
    if (!ok) {
      throw new UpdateError(
        `Signature verification failed for ${entry.packageVersion}`,
        'signature',
      );
    }
  }

  // 4. parse
  await runStage(deps.stageHook, 'parse');
  const parsed: ParsedPackage[] = [];
  try {
    for (const item of downloaded) {
      parsed.push(parsePackageText(item.text));
    }
  } catch (cause) {
    throw new UpdateError('Failed to parse package', 'parse', cause);
  }

  // 5. resolve
  await runStage(deps.stageHook, 'resolve');
  let snapshot;
  try {
    snapshot = resolveChain(parsed);
  } catch (cause) {
    throw new UpdateError('Failed to resolve package chain', 'resolve', cause);
  }

  // 6. index
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

  // 7. stage — write into the isolated staging store. Interruptible; staged
  // bytes are invisible to the repository, search, and deep links. A quota
  // error here aborts staging without touching committed data.
  await runStage(deps.stageHook, 'stage');
  try {
    await deps.store.stagePackage(stored);
  } catch (cause) {
    throw new UpdateError('Failed to stage package', 'stage', cause);
  }

  // 8. commit — promote staged → active with a compare-and-set on the active
  // pointer, AND migrate the reading-settings schema to the target package's
  // schema in the SAME transaction. If another tab advanced the pointer, this
  // loses the race and aborts; the staged copy is pruned. Quota or interruption
  // here rolls back the promotion — package, pointer, and settings together —
  // so a restart never sees {new package + old settings} or the reverse.
  await runStage(deps.stageHook, 'commit');

  // Compute the migrated settings from whatever is currently persisted. Invalid
  // stored data degrades to defaults without ever throwing, so a bad preference
  // cannot block the switch or lose the last usable settings silently.
  const targetSchema = settingsSchemaForPackage(snapshot.packageVersion);
  const rawSettings = await deps.store.getRawSettings();
  const base = coerceSettings(
    rawSettings?.value,
    DEFAULT_READING_SETTINGS,
  ).settings;
  const migratedSettings: StoredSettings = {
    value: migrateSettings(base, targetSchema),
    schemaVersion: normalizeSchema(targetSchema),
  };

  try {
    await deps.store.promoteStaged(
      snapshot.packageVersion,
      previousActive,
      migratedSettings,
    );
  } catch (cause) {
    // Whether we lost the race or hit quota, drop our staged copy so nothing
    // half-written is ever reachable. Pruning failures are non-fatal.
    await deps.store.pruneStaging().catch(() => undefined);
    if (cause instanceof StalePromotionError) {
      throw new UpdateError(
        `Lost concurrent update race for ${snapshot.packageVersion}`,
        'commit',
        cause,
      );
    }
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
    try {
      await updateTo(deps, manifest, base.packageVersion);
    } catch (cause) {
      // Another tab may have installed the base concurrently. Only rethrow if
      // we still have no complete active package.
      const now = await deps.store.getActiveVersion();
      if (now === undefined) {
        throw cause;
      }
    }
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
