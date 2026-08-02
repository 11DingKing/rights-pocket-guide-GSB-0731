/**
 * App bootstrap — composes the storage, service, and repository layers into a
 * single entry point for the view layer. This is where the first-launch
 * behaviour lives: the app must be fully usable offline immediately, so we seed
 * from the bundled packs when the network is unavailable.
 */
import { bundledManifestText, bundledPackTexts } from '../bundled/seed';
import type { StoredPackage } from '../core/types';
import { PackageStore } from '../storage/packageStore';
import { BundledFetcher, HttpFetcher, type TextFetcher } from './fetcher';
import { ContentRepository } from './repository';
import {
  ensureUpToDate,
  type UpdateDeps,
  type UpdateError,
} from './updateService';

export interface BootstrapResult {
  readonly repository: ContentRepository;
  readonly activeVersion: string;
  readonly latestAttempted: string;
  /** Present when the update to latest failed but a complete version is active. */
  readonly updateError?: UpdateError;
  /** True when we had to fall back to the bundled seed (offline first launch). */
  readonly usedBundledSeed: boolean;
}

export interface BootstrapOptions {
  readonly baseUrl?: string;
  readonly manifestUrl?: string;
  /** Override the fetcher (tests). */
  readonly fetcher?: TextFetcher;
  /** Override the store (tests). */
  readonly store?: PackageStore;
}

const DEFAULT_MANIFEST_URL = 'materials/manifest.json';

function resolveBaseUrl(explicit?: string): string {
  if (explicit !== undefined) {
    return explicit;
  }
  if (typeof document !== 'undefined' && document.baseURI.length > 0) {
    return document.baseURI;
  }
  return 'http://localhost/';
}

/**
 * Initialize the app and return a repository bound to the active package.
 *
 * Order of operations:
 *  1. Open IndexedDB.
 *  2. Try a network update (bootstrap base if empty, then advance to latest).
 *  3. If the network manifest is unreachable AND nothing is installed, seed
 *     from the bundled packs so the first launch works offline.
 *  4. Load whatever the active pointer names — always a complete package.
 */
export async function bootstrap(
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const store = options.store ?? (await PackageStore.open());
  const manifestUrl = options.manifestUrl ?? DEFAULT_MANIFEST_URL;
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const networkFetcher =
    options.fetcher ?? new HttpFetcher(baseUrl);

  let updateError: UpdateError | undefined;
  let latestAttempted = '';
  let usedBundledSeed = false;

  const deps: UpdateDeps = {
    store,
    fetcher: networkFetcher,
    manifestUrl,
  };

  try {
    const result = await ensureUpToDate(deps);
    latestAttempted = result.attemptedVersion;
    updateError = result.updateError;
  } catch (networkFailure) {
    // Network/manifest unreachable. If we already have a complete package,
    // keep using it. Otherwise seed offline from the bundled packs.
    const active = await store.getActiveVersion();
    if (active === undefined) {
      const bundledDeps: UpdateDeps = {
        store,
        fetcher: new BundledFetcher(bundledManifestText, bundledPackTexts),
        manifestUrl,
      };
      const seeded = await ensureUpToDate(bundledDeps);
      latestAttempted = seeded.attemptedVersion;
      updateError = seeded.updateError;
      usedBundledSeed = true;
    } else {
      latestAttempted = active;
      void networkFailure;
    }
  }

  const pkg: StoredPackage | undefined = await store.getActivePackage();
  if (pkg === undefined) {
    throw new Error('No active package after bootstrap');
  }

  return {
    repository: new ContentRepository(pkg, store),
    activeVersion: pkg.packageVersion,
    latestAttempted,
    ...(updateError === undefined ? {} : { updateError }),
    usedBundledSeed,
  };
}
