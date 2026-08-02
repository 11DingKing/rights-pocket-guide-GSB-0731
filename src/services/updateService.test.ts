import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { PackageStore } from '../storage/packageStore';
import { BundledFetcher, type TextFetcher } from '../services/fetcher';
import {
  ensureUpToDate,
  fetchManifest,
  updateTo,
  UpdateError,
  type StageHook,
  type UpdateDeps,
  type UpdateStage,
} from '../services/updateService';
import v1 from '../../materials/content-pack-v1.json';
import v2 from '../../materials/content-pack-v2.json';
import { createHash } from 'node:crypto';

const v1Text = JSON.stringify(v1);
const v2Text = JSON.stringify(v2);

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Build a manifest whose checksums match the JSON we serialize here.
const manifestText = JSON.stringify({
  latest: '2026.09.01',
  packages: [
    {
      packageVersion: '2026.07.31',
      url: 'materials/content-pack-v1.json',
      sha256: sha256(v1Text),
      kind: 'full',
    },
    {
      packageVersion: '2026.09.01',
      url: 'materials/content-pack-v2.json',
      sha256: sha256(v2Text),
      kind: 'delta',
      succeeds: '2026.07.31',
    },
  ],
});

const packTexts: Record<string, string> = {
  'content-pack-v1.json': v1Text,
  'content-pack-v2.json': v2Text,
};

/** Reset the global IndexedDB between tests so restarts are isolated. */
function freshIndexedDb(): void {
  // A brand-new factory drops any previously stored databases.
  globalThis.indexedDB = new IDBFactory();
}

function makeDeps(
  store: PackageStore,
  overrides: Partial<UpdateDeps> = {},
): UpdateDeps {
  const fetcher: TextFetcher =
    overrides.fetcher ?? new BundledFetcher(manifestText, packTexts);
  return {
    store,
    fetcher,
    manifestUrl: 'materials/manifest.json',
    ...overrides,
  };
}

describe('atomic package switching and rollback', () => {
  beforeEach(() => {
    freshIndexedDb();
  });

  afterEach(() => {
    freshIndexedDb();
  });

  it('installs the base full package then advances to latest', async () => {
    const store = await PackageStore.open();
    const deps = makeDeps(store);
    const result = await ensureUpToDate(deps);
    expect(result.activeVersion).toBe('2026.09.01');
    expect(result.updateError).toBeUndefined();

    const active = await store.getActivePackage();
    expect(active?.packageVersion).toBe('2026.09.01');
    expect(active?.snapshot.redirects['ART-AID-2']).toBe('ART-SERVICE-3');
  });

  const stages: UpdateStage[] = [
    'download',
    'verify',
    'parse',
    'resolve',
    'index',
    'commit',
  ];

  for (const failAt of stages) {
    it(`rolls back cleanly when interrupted at "${failAt}" (old version stays complete)`, async () => {
      // First, get a complete v1 installed.
      const store = await PackageStore.open();
      await updateTo(makeDeps(store), await fetchManifest(makeDeps(store)), '2026.07.31');
      expect(await store.getActiveVersion()).toBe('2026.07.31');

      // Now attempt to advance to v2 but fail at the chosen stage.
      const hook: StageHook = (stage) => {
        if (stage === failAt) {
          throw new Error(`injected failure at ${stage}`);
        }
      };
      const deps = makeDeps(store, { stageHook: hook });
      const manifest = await fetchManifest(deps);
      await expect(updateTo(deps, manifest, '2026.09.01')).rejects.toBeInstanceOf(
        UpdateError,
      );

      // The active version must still be the complete old one, and the new
      // version must not be readable through the active pointer.
      expect(await store.getActiveVersion()).toBe('2026.07.31');
      const active = await store.getActivePackage();
      expect(active?.packageVersion).toBe('2026.07.31');
      // v1 has ART-AID-2 present and no redirects (no mixing with v2).
      expect(active?.snapshot.articles['ART-AID-2']).toBeDefined();
      expect(active?.snapshot.redirects['ART-AID-2']).toBeUndefined();
      expect(active?.snapshot.articles['ART-SERVICE-3']).toBeUndefined();
    });
  }

  it('treats a checksum mismatch as a failed download and keeps old version', async () => {
    const store = await PackageStore.open();
    await updateTo(makeDeps(store), await fetchManifest(makeDeps(store)), '2026.07.31');

    // Corrupt v2's bytes so its sha256 no longer matches the manifest.
    const corruptFetcher = new BundledFetcher(manifestText, {
      ...packTexts,
      'content-pack-v2.json': `${v2Text} `,
    });
    const deps = makeDeps(store, { fetcher: corruptFetcher });
    const manifest = await fetchManifest(deps);
    const err = await updateTo(deps, manifest, '2026.09.01').catch((e) => e);
    expect(err).toBeInstanceOf(UpdateError);
    expect((err as UpdateError).stage).toBe('verify');
    expect(await store.getActiveVersion()).toBe('2026.07.31');
  });

  it('survives a simulated IndexedDB quota error during commit', async () => {
    const store = await PackageStore.open();
    await updateTo(makeDeps(store), await fetchManifest(makeDeps(store)), '2026.07.31');

    // Wrap the store so the commit transaction throws a QuotaExceededError,
    // emulating staging that runs out of space. The pointer must not move.
    const quotaError = new DOMException('quota', 'QuotaExceededError');
    const failingStore = Object.create(store) as PackageStore;
    Object.defineProperty(failingStore, 'commitActivePackage', {
      value: () => Promise.reject(quotaError),
    });
    const deps = makeDeps(failingStore);
    const manifest = await fetchManifest(deps);
    const err = await updateTo(deps, manifest, '2026.09.01').catch((e) => e);
    expect(err).toBeInstanceOf(UpdateError);
    expect((err as UpdateError).stage).toBe('commit');

    // Underlying real store still points at the complete old version.
    expect(await store.getActiveVersion()).toBe('2026.07.31');
  });
});

describe('restart shows only a complete old or complete new package', () => {
  beforeEach(() => {
    freshIndexedDb();
  });

  it('after a failed update, reopening the DB yields the complete old package', async () => {
    // Session 1: install v1, then fail the upgrade to v2 at commit.
    const store1 = await PackageStore.open();
    await updateTo(makeDeps(store1), await fetchManifest(makeDeps(store1)), '2026.07.31');
    const hook: StageHook = (stage) => {
      if (stage === 'commit') {
        throw new Error('interrupted before commit');
      }
    };
    await updateTo(
      makeDeps(store1, { stageHook: hook }),
      await fetchManifest(makeDeps(store1)),
      '2026.09.01',
    ).catch(() => undefined);
    store1.close();

    // Session 2 (simulated restart): same underlying data.
    const store2 = await PackageStore.open();
    const active = await store2.getActivePackage();
    expect(active?.packageVersion).toBe('2026.07.31');
    expect(active?.snapshot.articles['ART-AID-2']).toBeDefined();
    expect(active?.snapshot.articles['ART-SERVICE-3']).toBeUndefined();
  });

  it('after a successful update, reopening yields the complete new package', async () => {
    const store1 = await PackageStore.open();
    await ensureUpToDate(makeDeps(store1));
    store1.close();

    const store2 = await PackageStore.open();
    const active = await store2.getActivePackage();
    expect(active?.packageVersion).toBe('2026.09.01');
    expect(active?.snapshot.articles['ART-AID-2']).toBeUndefined();
    expect(active?.snapshot.articles['ART-SERVICE-3']).toBeDefined();
    expect(active?.snapshot.redirects['ART-AID-2']).toBe('ART-SERVICE-3');
  });
});
