import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { PackageStore } from '../storage/packageStore';
import { BundledFetcher } from '../services/fetcher';
import { ContentRepository } from '../services/repository';
import {
  fetchManifest,
  updateTo,
  UpdateError,
  type StageHook,
  type UpdateDeps,
} from './updateService';
import { coerceSettings, migrateSettings } from '../core/readingSettings';
import type { ReadingSettings } from '../core/types';
import { baseOnlyManifestText, manifestText, packTexts } from '../test/fixtures';

/**
 * Settings-schema upgrade coupled to the atomic package switch. Reuses round-1
 * settings shape and round-2 replacement relation / packageVersion. The key
 * invariant: a forced restart lands on {old package + old settings} OR {new
 * package + new settings} — never a cross-version mix.
 */
function freshIndexedDb(): void {
  globalThis.indexedDB = new IDBFactory();
}

function deps(store: PackageStore, mText: string, stageHook?: StageHook): UpdateDeps {
  return {
    store,
    fetcher: new BundledFetcher(mText, packTexts),
    manifestUrl: 'materials/manifest.json',
    ...(stageHook === undefined ? {} : { stageHook }),
  };
}

/** Install v1 (schema 1) with a custom non-default settings value persisted. */
async function seedV1WithSettings(
  store: PackageStore,
  settings: ReadingSettings,
): Promise<void> {
  await updateTo(
    deps(store, baseOnlyManifestText),
    await fetchManifest(deps(store, baseOnlyManifestText)),
    '2026.07.31',
  );
  await store.saveSettings(settings, 1);
}

describe('settings schema upgrade is atomic with the package switch', () => {
  beforeEach(() => {
    freshIndexedDb();
  });
  afterEach(() => {
    freshIndexedDb();
  });

  it('interrupting settings migration mid-commit keeps old package AND old settings', async () => {
    const store = await PackageStore.open();
    const oldSettings: ReadingSettings = {
      fontScale: 'large',
      contrast: 'high',
      lineSpacing: 'loose',
      underlineLinks: 'on',
    };
    await seedV1WithSettings(store, oldSettings);
    expect(await store.getActiveVersion()).toBe('2026.07.31');
    expect((await store.getRawSettings())?.schemaVersion).toBe(1);

    // Force a failure exactly at the commit boundary — the promotion writes the
    // package, pointer, AND migrated settings in one transaction, so this must
    // roll back all three.
    const hook: StageHook = (stage) => {
      if (stage === 'commit') {
        throw new Error('forced restart before commit');
      }
    };
    const d = deps(store, manifestText, hook);
    const err = await updateTo(d, await fetchManifest(d), '2026.09.01').catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(UpdateError);

    // Simulated restart: reopen and confirm NO cross-version mix.
    store.close();
    const restart = await PackageStore.open();
    expect(await restart.getActiveVersion()).toBe('2026.07.31');
    const raw = await restart.getRawSettings();
    expect(raw?.schemaVersion).toBe(1); // old schema
    expect(raw?.value.fontScale).toBe('large'); // old settings preserved
    // The active package is still complete v1 (no v2 content leaked in).
    const pkg = await restart.getActivePackage();
    expect(pkg?.snapshot.articles['ART-AID-2']).toBeDefined();
    expect(pkg?.snapshot.articles['ART-SERVICE-3']).toBeUndefined();
    restart.close();
  });

  it('a successful switch commits new package AND schema-2 settings together', async () => {
    const store = await PackageStore.open();
    await seedV1WithSettings(store, {
      fontScale: 'xlarge',
      contrast: 'normal',
      lineSpacing: 'normal',
      underlineLinks: 'on',
    });

    const d = deps(store, manifestText);
    await updateTo(d, await fetchManifest(d), '2026.09.01');

    store.close();
    const restart = await PackageStore.open();
    expect(await restart.getActiveVersion()).toBe('2026.09.01');
    const raw = await restart.getRawSettings();
    expect(raw?.schemaVersion).toBe(2); // migrated to new schema
    // User's still-valid preferences carried across the migration.
    expect(raw?.value.fontScale).toBe('xlarge');
    // New schema field present with its default.
    expect(raw?.value.underlineLinks).toBe('on');
    const pkg = await restart.getActivePackage();
    expect(pkg?.snapshot.articles['ART-SERVICE-3']).toBeDefined();
    restart.close();
  });
});

describe('accessible degraded states never lose the last usable settings', () => {
  beforeEach(() => {
    freshIndexedDb();
  });
  afterEach(() => {
    freshIndexedDb();
  });

  it('invalid stored preferences fall back to the last usable value (no throw)', async () => {
    const store = await PackageStore.open();
    await updateTo(
      deps(store, manifestText),
      await fetchManifest(deps(store, manifestText)),
      '2026.09.01',
    );

    // Persist a deliberately invalid settings value (bypassing validation) to
    // emulate a corrupt record from an older/foreign writer.
    const bogus = {
      fontScale: 'ludicrous',
      contrast: 42,
      lineSpacing: null,
      underlineLinks: 'maybe',
    } as unknown as ReadingSettings;
    await store.saveSettings(bogus, 2);

    const pkg = await store.getActivePackage();
    if (pkg === undefined) {
      throw new Error('no active package');
    }
    const repo = new ContentRepository(pkg, store);
    const loaded = await repo.loadSettings();

    // Never throws; degrades to defaults and flags invalid.
    expect(loaded.valid).toBe(false);
    expect(loaded.settings.fontScale).toBe('normal');
    expect(loaded.settings.underlineLinks).toBe('on');
    store.close();
  });

  it('quota on save keeps the last usable settings intact', async () => {
    const store = await PackageStore.open();
    await updateTo(
      deps(store, manifestText),
      await fetchManifest(deps(store, manifestText)),
      '2026.09.01',
    );
    // Save a good value first.
    await store.saveSettings(
      {
        fontScale: 'large',
        contrast: 'normal',
        lineSpacing: 'normal',
        underlineLinks: 'off',
      },
      2,
    );

    const pkg = await store.getActivePackage();
    if (pkg === undefined) {
      throw new Error('no active package');
    }

    // Wrap the store so the NEXT save rejects with a quota error.
    const failing = Object.create(store) as PackageStore;
    Object.defineProperty(failing, 'saveSettings', {
      value: () => Promise.reject(new DOMException('quota', 'QuotaExceededError')),
    });
    const repo = new ContentRepository(pkg, failing);
    const saveResult = await repo
      .saveSettings({
        fontScale: 'xlarge',
        contrast: 'high',
        lineSpacing: 'loose',
        underlineLinks: 'on',
      })
      .then(
        () => 'ok' as const,
        () => 'quota' as const,
      );
    expect(saveResult).toBe('quota');

    // The last successfully persisted settings survive unchanged.
    const raw = await store.getRawSettings();
    expect(raw?.value.fontScale).toBe('large');
    expect(raw?.value.underlineLinks).toBe('off');
    store.close();
  });

  it('coerce/migrate helpers are pure and total', () => {
    // Down-migration drops schema-2 field to default; up keeps valid values.
    const s: ReadingSettings = {
      fontScale: 'large',
      contrast: 'high',
      lineSpacing: 'loose',
      underlineLinks: 'off',
    };
    expect(migrateSettings(s, 1).underlineLinks).toBe('on');
    expect(migrateSettings(s, 2)).toEqual(s);
    // Invalid input never throws.
    expect(coerceSettings(undefined).valid).toBe(false);
    expect(coerceSettings({ fontScale: 'large' }).settings.fontScale).toBe(
      'large',
    );
  });
});
