import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { PackageStore } from '../storage/packageStore';
import { BundledFetcher } from '../services/fetcher';
import { ContentRepository } from '../services/repository';
import {
  ensureUpToDate,
  fetchManifest,
  updateTo,
  type UpdateDeps,
} from '../services/updateService';
import { baseOnlyManifestText, manifestText, packTexts } from '../test/fixtures';

/**
 * Cross-version determinism: for the SAME query, compare v1 vs v2 ranking, the
 * withdrawn→replacement relation, and the visible article set after an offline
 * restart. Everything must be complete and deterministic — computed only from
 * the committed active package, identically on every run.
 */
function freshIndexedDb(): void {
  globalThis.indexedDB = new IDBFactory();
}

function depsFor(store: PackageStore, mText: string): UpdateDeps {
  return {
    store,
    fetcher: new BundledFetcher(mText, packTexts),
    manifestUrl: 'materials/manifest.json',
  };
}

/** Install exactly `version` in a fresh DB and return a bound repository. */
async function repoAt(version: '2026.07.31' | '2026.09.01'): Promise<{
  repo: ContentRepository;
  store: PackageStore;
}> {
  freshIndexedDb();
  const store = await PackageStore.open();
  // Use the base-only manifest for v1 so latest === v1; full manifest for v2.
  const mText = version === '2026.07.31' ? baseOnlyManifestText : manifestText;
  await updateTo(depsFor(store, mText), await fetchManifest(depsFor(store, mText)), version);
  const pkg = await store.getActivePackage();
  if (pkg === undefined) {
    throw new Error('no active package');
  }
  return { repo: new ContentRepository(pkg, store), store };
}

describe('v1 vs v2 comparison', () => {
  afterEach(() => {
    freshIndexedDb();
  });

  it('ranks a shared query identically for the surviving article', async () => {
    const a = await repoAt('2026.07.31');
    const b = await repoAt('2026.09.01');

    // ART-NOTARY-1 is untouched across versions; the same query must rank it
    // top in both, with the same score.
    const q = '公证';
    const r1 = a.repo.search(q);
    const r2 = b.repo.search(q);
    expect(r1[0]?.articleId).toBe('ART-NOTARY-1');
    expect(r2[0]?.articleId).toBe('ART-NOTARY-1');
    expect(r1[0]?.score).toBe(r2[0]?.score);

    a.store.close();
    b.store.close();
  });

  it('differs only where content changed: revised article searchable, withdrawn gone', async () => {
    const a = await repoAt('2026.07.31');
    const b = await repoAt('2026.09.01');

    // v1: ART-AID-2 exists and is searchable by its old wording.
    expect(a.repo.getArticle('ART-AID-2')).toBeDefined();
    expect(a.repo.search('渠道').map((h) => h.articleId)).toContain('ART-AID-2');

    // v2: ART-AID-2 is withdrawn — absent from content and search — replaced by
    // ART-SERVICE-3, which is searchable instead.
    expect(b.repo.getArticle('ART-AID-2')).toBeUndefined();
    expect(b.repo.search('渠道').map((h) => h.articleId)).not.toContain(
      'ART-AID-2',
    );
    expect(b.repo.search('上门').map((h) => h.articleId)).toContain(
      'ART-SERVICE-3',
    );

    a.store.close();
    b.store.close();
  });

  it('resolves the withdrawn→replacement deep link deterministically in v2 only', async () => {
    const a = await repoAt('2026.07.31');
    const b = await repoAt('2026.09.01');

    // v1: ART-AID-2 is a live article, no migration.
    const link1 = a.repo.resolveDeepLink('ART-AID-2');
    expect(link1).toEqual({
      kind: 'resolved',
      articleId: 'ART-AID-2',
      migrated: false,
      requestedId: 'ART-AID-2',
    });

    // v2: ART-AID-2 migrates to ART-SERVICE-3, same result every run.
    const link2a = b.repo.resolveDeepLink('ART-AID-2');
    const link2b = b.repo.resolveDeepLink('ART-AID-2');
    expect(link2a).toEqual({
      kind: 'resolved',
      articleId: 'ART-SERVICE-3',
      migrated: true,
      requestedId: 'ART-AID-2',
    });
    expect(link2a).toEqual(link2b);

    a.store.close();
    b.store.close();
  });

  it('offline restart shows the complete, deterministic visible set for the active version', async () => {
    // Fresh DB, go straight to latest (v2), then simulate two offline restarts.
    freshIndexedDb();
    const s1 = await PackageStore.open();
    await ensureUpToDate(depsFor(s1, manifestText));
    s1.close();

    const visibleSet = async (): Promise<{
      version: string;
      topicArticleIds: string[];
      allArticleIds: string[];
    }> => {
      const store = await PackageStore.open();
      const pkg = await store.getActivePackage();
      if (pkg === undefined) {
        throw new Error('no active package after restart');
      }
      const repo = new ContentRepository(pkg, store);
      const topicArticleIds = repo.topics
        .flatMap((t) => t.articleIds)
        .sort();
      const allArticleIds = repo.topics
        .flatMap((t) => t.articleIds)
        .concat(Object.keys(pkg.snapshot.articles))
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .sort();
      store.close();
      return { version: pkg.packageVersion, topicArticleIds, allArticleIds };
    };

    const restart1 = await visibleSet();
    const restart2 = await visibleSet();

    // Deterministic: identical across restarts.
    expect(restart1).toEqual(restart2);
    // Complete v2 visible set: revised + added present, withdrawn absent.
    expect(restart1.version).toBe('2026.09.01');
    expect(restart1.allArticleIds).toEqual([
      'ART-AID-1',
      'ART-NOTARY-1',
      'ART-SERVICE-3',
    ]);
    expect(restart1.topicArticleIds).toEqual([
      'ART-AID-1',
      'ART-NOTARY-1',
      'ART-SERVICE-3',
    ]);
    // The withdrawn article never appears in the visible set.
    expect(restart1.allArticleIds).not.toContain('ART-AID-2');
  });
});
