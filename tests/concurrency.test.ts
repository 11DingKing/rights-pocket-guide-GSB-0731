import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContentService } from '../src/services/contentService';
import { UpdateConflictError } from '../src/storage/db';
import type { ContentRepository } from '../src/storage/repository';
import {
  buildAlternativePack,
  bytesDownloader,
  createRepository,
  deleteDatabase,
  expectedV2Checksum,
  loadV2Bytes,
  openSecondTab,
  seedPack,
} from './helpers';

let repoA: ContentRepository;
let serviceA: ContentService;

beforeEach(async () => {
  repoA = await createRepository();
  serviceA = new ContentService(repoA);
  await serviceA.initialize(seedPack());
});

afterEach(async () => {
  repoA.close();
  await deleteDatabase();
});

function visibleArticleIds(service: ContentService): string[] {
  const pack = service.getState().pack;
  return pack ? Object.keys(pack.articles).sort() : [];
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('two-tab concurrent update (same version)', () => {
  it('lets exactly one tab commit; both converge on v2 with no orphan data', async () => {
    const tabB = await openSecondTab();
    try {
      const checksum = await expectedV2Checksum();
      const bytes = loadV2Bytes();

      const [aResult, bResult] = await Promise.allSettled([
        serviceA.checkUpdate('/content-pack-v2.json', {
          expectedChecksum: checksum,
          downloader: bytesDownloader(bytes),
        }),
        tabB.service.checkUpdate('/content-pack-v2.json', {
          expectedChecksum: checksum,
          downloader: bytesDownloader(bytes),
        }),
      ]);

      expect(aResult.status).toBe('fulfilled');
      expect(bResult.status).toBe('fulfilled');

      const conflicts = [aResult, bResult].filter(
        (r): r is PromiseRejectedResult =>
          r.status === 'rejected' &&
          r.reason instanceof UpdateConflictError,
      );
      expect(conflicts.length).toBe(0);

      for (const service of [serviceA, tabB.service]) {
        const state = service.getState();
        expect(state.pack?.packageVersion).toBe('2026.09.01');
        expect(state.index?.search('上门服务')[0]?.articleId).toBe(
          'ART-SERVICE-3',
        );
        expect(state.pack?.articles['ART-AID-2']).toBeUndefined();
        expect(state.pack?.withdrawals['ART-AID-2']?.replacementArticleId).toBe(
          'ART-SERVICE-3',
        );
      }

      expect(await repoA.getStagedVersion()).toBeNull();
      const v2Pack = await repoA.getPack('2026.09.01');
      const v1Pack = await repoA.getPack('2026.07.31');
      expect(v2Pack?.packageVersion).toBe('2026.09.01');
      expect(v1Pack?.packageVersion).toBe('2026.07.31');
    } finally {
      tabB.repository.close();
    }
  });
});

describe('two-tab concurrent update (different versions)', () => {
  it('only one version becomes active; the failed candidate is deleted and unsearchable', async () => {
    const tabB = await openSecondTab();
    const aCommitted = deferred<void>();
    try {
      const checksum = await expectedV2Checksum();
      const v2Bytes = loadV2Bytes();
      const alt = buildAlternativePack(seedPack(), '2026.10.01');
      const altChecksum = await alt.checksum;

      const slowDownloaderForB = async (): Promise<Uint8Array> => {
        await aCommitted.promise;
        return alt.bytes;
      };

      const updateA = serviceA.checkUpdate('/content-pack-v2.json', {
        expectedChecksum: checksum,
        downloader: bytesDownloader(v2Bytes),
      });
      const updateB = tabB.service.checkUpdate('/alt.json', {
        expectedChecksum: altChecksum,
        downloader: slowDownloaderForB,
      });

      await updateA;
      aCommitted.resolve();

      await expect(updateB).rejects.toBeInstanceOf(UpdateConflictError);

      const stateA = serviceA.getState();
      const stateB = tabB.service.getState();
      expect(stateA.pack?.packageVersion).toBe('2026.09.01');
      expect(stateB.pack?.packageVersion).toBe('2026.09.01');

      expect(stateB.updateStatus.phase).toBe('failed');
      expect(stateB.updateStatus.message).toContain('另一个标签页已提交版本');

      const exclusiveHitsA = stateA.index?.search('替代版本专属文章');
      const exclusiveHitsB = stateB.index?.search('替代版本专属文章');
      expect(exclusiveHitsA).toHaveLength(0);
      expect(exclusiveHitsB).toHaveLength(0);

      expect(stateB.pack?.articles['ART-ALT-2026.10.01']).toBeUndefined();
      expect(
        stateB.pack?.withdrawals['ART-ALT-2026.10.01'],
      ).toBeUndefined();

      expect(await repoA.getPack('2026.10.01')).toBeNull();
      expect(await repoA.getStagedVersion()).toBeNull();
    } finally {
      tabB.repository.close();
    }
  });

  it('shows only the complete winning version after restart with no leftover chunks or temp metadata', async () => {
    const tabB = await openSecondTab();
    const aCommitted = deferred<void>();
    try {
      const checksum = await expectedV2Checksum();
      const alt = buildAlternativePack(seedPack(), '2026.10.01');

      const updateA = serviceA.checkUpdate('/content-pack-v2.json', {
        expectedChecksum: checksum,
        downloader: bytesDownloader(loadV2Bytes()),
      });
      const updateB = tabB.service.checkUpdate('/alt.json', {
        expectedChecksum: await alt.checksum,
        downloader: async () => {
          await aCommitted.promise;
          return alt.bytes;
        },
      });

      await updateA;
      aCommitted.resolve();
      await expect(updateB).rejects.toBeInstanceOf(UpdateConflictError);
    } finally {
      tabB.repository.close();
    }

    repoA.close();
    const restartedRepo = await (
      await import('../src/storage/repository')
    ).ContentRepository.open();
    const restarted = new ContentService(restartedRepo);
    await restarted.initialize(seedPack());

    try {
      const state = restarted.getState();
      expect(state.pack?.packageVersion).toBe('2026.09.01');
      expect(await restartedRepo.getStagedVersion()).toBeNull();
      expect(await restartedRepo.getPack('2026.10.01')).toBeNull();
      expect(visibleArticleIds(restarted)).toEqual(
        Object.keys(state.pack?.articles ?? {}).sort(),
      );
      expect(visibleArticleIds(restarted)).toEqual([
        'ART-AID-1',
        'ART-NOTARY-1',
        'ART-SERVICE-3',
      ]);
      expect(restarted.getState().index?.search('替代版本专属文章')).toHaveLength(
        0,
      );
    } finally {
      restartedRepo.close();
    }
  });
});
