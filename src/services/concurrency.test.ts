import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { PackageStore } from '../storage/packageStore';
import { BundledFetcher } from '../services/fetcher';
import {
  fetchManifest,
  updateTo,
  UpdateError,
  type StageHook,
  type UpdateDeps,
} from './updateService';
import { manifestText, packTexts } from '../test/fixtures';

/**
 * Two-tab concurrency. Each "tab" is a separate PackageStore connection to the
 * same IndexedDB database. Both start from a complete v1 and race to install
 * v2. The compare-and-set promotion guarantees exactly one commits; the loser's
 * staged snapshot must never become visible to the repository, search, or deep
 * links.
 */
function freshIndexedDb(): void {
  globalThis.indexedDB = new IDBFactory();
}

function deps(store: PackageStore, stageHook?: StageHook): UpdateDeps {
  return {
    store,
    fetcher: new BundledFetcher(manifestText, packTexts),
    manifestUrl: 'materials/manifest.json',
    ...(stageHook === undefined ? {} : { stageHook }),
  };
}

describe('two tabs racing to update', () => {
  beforeEach(() => {
    freshIndexedDb();
  });
  afterEach(() => {
    freshIndexedDb();
  });

  it('commits exactly one version; the loser leaves nothing readable', async () => {
    // Shared starting point: v1 committed.
    const seed = await PackageStore.open();
    await updateTo(deps(seed), await fetchManifest(deps(seed)), '2026.07.31');
    expect(await seed.getActiveVersion()).toBe('2026.07.31');
    seed.close();

    // Two independent connections (tabs) to the same DB.
    const tabA = await PackageStore.open();
    const tabB = await PackageStore.open();

    // Interleave: both stage before either promotes, so both then contend on
    // the compare-and-set. A gate on the 'commit' stage lets both reach staging
    // first. Tab A is released to commit first; Tab B commits second and must
    // lose the race because A already advanced the pointer.
    let releaseB: (() => void) | undefined;
    const bGate = new Promise<void>((resolve) => {
      releaseB = resolve;
    });

    const hookA: StageHook = () => undefined;
    const hookB: StageHook = async (stage) => {
      if (stage === 'commit') {
        await bGate; // hold B at the commit boundary until A has committed
      }
    };

    const mA = await fetchManifest(deps(tabA));
    const mB = await fetchManifest(deps(tabB));

    const pB = updateTo(deps(tabB, hookB), mB, '2026.09.01');
    const rA = await updateTo(deps(tabA, hookA), mA, '2026.09.01');
    expect(rA.activeVersion).toBe('2026.09.01');

    // Now let B proceed to its compare-and-set; it should lose.
    releaseB?.();
    const bOutcome = await pB.then(
      () => ({ ok: true as const }),
      (e: unknown) => ({ ok: false as const, error: e }),
    );
    expect(bOutcome.ok).toBe(false);
    if (!bOutcome.ok) {
      expect(bOutcome.error).toBeInstanceOf(UpdateError);
      expect((bOutcome.error as UpdateError).stage).toBe('commit');
    }

    // Exactly one committed active version, and it is the winner's.
    expect(await tabA.getActiveVersion()).toBe('2026.09.01');
    expect(await tabB.getActiveVersion()).toBe('2026.09.01');

    // The loser left nothing in staging that could be read (no temp metadata).
    expect(await tabA.listStaged()).toEqual([]);

    // Committed store contains only complete versions (the prior base and the
    // new version) — never a partial/failed snapshot under a distinct key.
    expect(await tabA.listVersions()).toEqual(['2026.07.31', '2026.09.01']);

    // The visible package is a complete, single version — no mixing.
    const active = await tabA.getActivePackage();
    expect(active?.packageVersion).toBe('2026.09.01');
    expect(active?.snapshot.articles['ART-SERVICE-3']).toBeDefined();
    expect(active?.snapshot.articles['ART-AID-2']).toBeUndefined();

    tabA.close();
    tabB.close();
  });

  it('a losing tab cannot expose staged content via search or deep links', async () => {
    // Start at v1.
    const seed = await PackageStore.open();
    await updateTo(deps(seed), await fetchManifest(deps(seed)), '2026.07.31');
    seed.close();

    const winner = await PackageStore.open();
    const loser = await PackageStore.open();

    // Loser stages fully but is held at commit; winner commits v2.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loserHook: StageHook = async (stage) => {
      if (stage === 'commit') {
        await gate;
      }
    };

    const pLoser = updateTo(
      deps(loser, loserHook),
      await fetchManifest(deps(loser)),
      '2026.09.01',
    );
    await updateTo(deps(winner), await fetchManifest(deps(winner)), '2026.09.01');
    release?.();
    await pLoser.catch(() => undefined);

    // Reconstruct the repository the way the app would — only from the
    // committed active package. Staged data is structurally unreachable.
    const active = await loser.getActivePackage();
    expect(active?.packageVersion).toBe('2026.09.01');
    // No staged versions remain, so no alternate content could be indexed or
    // linked to.
    expect(await loser.listStaged()).toEqual([]);
    // Committed store contains only complete versions (base + new).
    expect(await loser.listVersions()).toEqual(['2026.07.31', '2026.09.01']);

    winner.close();
    loser.close();
  });
});
