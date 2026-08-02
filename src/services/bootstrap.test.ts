import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { bootstrap } from '../services/bootstrap';
import { FetchError, type TextFetcher } from '../services/fetcher';
import { PackageStore } from '../storage/packageStore';

/**
 * First offline launch: the network is completely unavailable, yet the app must
 * come up fully usable by seeding from the packs bundled at build time.
 */
class OfflineFetcher implements TextFetcher {
  fetchText(): Promise<string> {
    return Promise.reject(new FetchError('offline'));
  }
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('first offline launch uses the bundled seed', () => {
  it('boots a complete package with no network', async () => {
    const store = await PackageStore.open();
    const result = await bootstrap({
      store,
      fetcher: new OfflineFetcher(),
      manifestUrl: 'materials/manifest.json',
    });

    expect(result.usedBundledSeed).toBe(true);
    // The bundled seed advances to the latest version it ships.
    expect(result.activeVersion).toBe('2026.09.01');
    // Content is fully resolved and searchable offline.
    expect(result.repository.topics.length).toBeGreaterThan(0);
    expect(result.repository.search('援助').length).toBeGreaterThan(0);

    // A restart with the same (now-populated) DB still works offline and shows
    // the complete package without touching the seed again.
    const store2 = await PackageStore.open();
    const restart = await bootstrap({
      store: store2,
      fetcher: new OfflineFetcher(),
      manifestUrl: 'materials/manifest.json',
    });
    expect(restart.activeVersion).toBe('2026.09.01');
  });
});
