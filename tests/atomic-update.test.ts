import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ContentService, UpdateAbortedError } from '../src/services/contentService';
import { QuotaExceededStorageError } from '../src/storage/db';
import type { ContentRepository } from '../src/storage/repository';
import type { MaterializedPack, UpdatePhase } from '../src/types';
import {
  createRepository,
  createService,
  deleteDatabase,
  expectedV2Checksum,
  loadV2Bytes,
  materializeV2,
  rejectingDownloader,
  seedPack,
  bytesDownloader,
} from './helpers';

let repository: ContentRepository;

beforeEach(async () => {
  repository = await createRepository();
});

afterEach(async () => {
  repository.close();
  await deleteDatabase();
});

async function freshService(): Promise<ContentService> {
  const service = new ContentService(repository);
  await service.initialize(seedPack());
  return service;
}

function expectV1(service: ContentService): void {
  const state = service.getState();
  expect(state.pack?.packageVersion).toBe('2026.07.31');
  expect(state.pack?.articles['ART-AID-2']).toBeDefined();
  expect(state.pack?.articles['ART-SERVICE-3']).toBeUndefined();
  expect(state.index?.search('上门服务')[0]?.articleId).toBe('ART-AID-2');
}

function expectV2(service: ContentService): void {
  const state = service.getState();
  expect(state.pack?.packageVersion).toBe('2026.09.01');
  expect(state.pack?.articles['ART-AID-2']).toBeUndefined();
  expect(state.pack?.articles['ART-SERVICE-3']).toBeDefined();
  expect(state.pack?.withdrawals['ART-AID-2']?.replacementArticleId).toBe(
    'ART-SERVICE-3',
  );
  expect(state.index?.search('上门服务')[0]?.articleId).toBe('ART-SERVICE-3');
}

describe('atomic update', () => {
  it('switches from v1 to v2 atomically and rebuilds the index', async () => {
    const service = await freshService();
    expectV1(service);

    await service.checkUpdate('/content-pack-v2.json', {
      expectedChecksum: await expectedV2Checksum(),
      downloader: bytesDownloader(loadV2Bytes()),
    });

    expectV2(service);
    const active = await repository.getActivePack();
    expect(active?.packageVersion).toBe('2026.09.01');
  });

  it('keeps the complete old version when download is interrupted', async () => {
    const service = await freshService();
    const controller = new AbortController();
    await expect(
      service.checkUpdate('/content-pack-v2.json', {
        expectedChecksum: await expectedV2Checksum(),
        downloader: rejectingDownloader('network down'),
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expectV1(service);
    expect(await repository.getStagedVersion()).toBeNull();
  });

  it('keeps the complete old version when checksum mismatches', async () => {
    const service = await freshService();
    await expect(
      service.checkUpdate('/content-pack-v2.json', {
        expectedChecksum: '0000000000000000000000000000000000000000000000000000000000000000',
        downloader: bytesDownloader(loadV2Bytes()),
      }),
    ).rejects.toThrow();
    expectV1(service);
    expect(await repository.getStagedVersion()).toBeNull();
    expect(service.getState().updateStatus.phase).toBe('failed');
    expect(service.getState().updateStatus.message).toContain('完整性');
  });

  it('keeps the complete old version when IndexedDB quota is exceeded during staging', async () => {
    const real = repository;
    const failing = Object.create(real) as ContentRepository;
    failing.stage = async () => {
      throw new QuotaExceededStorageError('simulated quota');
    };
    const service = new ContentService(failing);
    await service.initialize(seedPack());

    await expect(
      service.checkUpdate('/content-pack-v2.json', {
        expectedChecksum: await expectedV2Checksum(),
        downloader: bytesDownloader(loadV2Bytes()),
      }),
    ).rejects.toBeInstanceOf(QuotaExceededStorageError);

    expectV1(service);
    expect(service.getState().updateStatus.message).toContain('存储空间');
  });

  it.each([
    ['downloading', 'verifying'],
    ['indexing', 'committing'],
  ] as ReadonlyArray<ReadonlyArray<UpdatePhase>>)(
    'discards staging and keeps v1 when interrupted at %s',
    async (phase) => {
      const service = await freshService();
      await expect(
        service.checkUpdate('/content-pack-v2.json', {
          expectedChecksum: await expectedV2Checksum(),
          downloader: bytesDownloader(loadV2Bytes()),
          onPhase: (next) => {
            if (next === phase) {
              throw new UpdateAbortedError(`interrupted at ${phase}`);
            }
          },
        }),
      ).rejects.toBeInstanceOf(UpdateAbortedError);

      expectV1(service);
      expect(await repository.getStagedVersion()).toBeNull();
      const v2InDb = await repository.getPack('2026.09.01');
      expect(v2InDb).toBeNull();
    },
  );

  it('exposes only the old pack right up to the atomic commit', async () => {
    const service = await freshService();
    const observed: { pack: MaterializedPack | null } = { pack: null };
    await service.checkUpdate('/content-pack-v2.json', {
      expectedChecksum: await expectedV2Checksum(),
      downloader: bytesDownloader(loadV2Bytes()),
      onPhase: (phase) => {
        if (phase === 'committing') {
          observed.pack = service.getState().pack;
        }
      },
    });
    expect(observed.pack?.packageVersion).toBe('2026.07.31');
    expectV2(service);
  });

  it('cleans up interrupted staging on restart and shows only the complete old pack', async () => {
    await freshService();
    await repository.stage(materializeV2(seedPack()));
    expect(await repository.getStagedVersion()).toBe('2026.09.01');

    const restarted = new ContentService(repository);
    await restarted.initialize(seedPack());
    expect(restarted.getState().pack?.packageVersion).toBe('2026.07.31');
    expect(await repository.getStagedVersion()).toBeNull();
    expect(await repository.getPack('2026.09.01')).toBeNull();
  });

  it('boots offline from the bundled seed without any network', async () => {
    repository.close();
    await deleteDatabase();
    const offlineRepo = await createRepository();
    try {
      const service = new ContentService(offlineRepo);
      await service.initialize(seedPack());
      expectV1(service);

      await expect(
        service.checkUpdate('/content-pack-v2.json', {
          expectedChecksum: await expectedV2Checksum(),
          downloader: rejectingDownloader('offline'),
        }),
      ).rejects.toThrow();
      expectV1(service);
    } finally {
      offlineRepo.close();
      await deleteDatabase();
    }
    repository = await createRepository();
  });

  it('rolls back to the previous complete version', async () => {
    const service = await freshService();
    await service.checkUpdate('/content-pack-v2.json', {
      expectedChecksum: await expectedV2Checksum(),
      downloader: bytesDownloader(loadV2Bytes()),
    });
    expectV2(service);

    const version = await service.rollback();
    expect(version).toBe('2026.07.31');
    expectV1(service);
  });

  it('preserves reading settings across a version update', async () => {
    const service = await freshService();
    await service.updateSettings({ fontSize: 'large', theme: 'dark' });
    await service.checkUpdate('/content-pack-v2.json', {
      expectedChecksum: await expectedV2Checksum(),
      downloader: bytesDownloader(loadV2Bytes()),
    });
    expect(service.getState().settings).toEqual({
      fontSize: 'large',
      theme: 'dark',
    });
  });

  it('emits phase announcements in order', async () => {
    const service = await freshService();
    const phases: UpdatePhase[] = [];
    await service.checkUpdate('/content-pack-v2.json', {
      expectedChecksum: await expectedV2Checksum(),
      downloader: bytesDownloader(loadV2Bytes()),
      onPhase: (phase) => phases.push(phase),
    });
    expect(phases).toEqual([
      'downloading',
      'verifying',
      'resolving',
      'staging',
      'indexing',
      'committing',
    ]);
    expect(service.getState().updateStatus.phase).toBe('success');
  });
});

describe('service factory helper smoke test', () => {
  it('createService helper returns a ready v1 service', async () => {
    repository.close();
    const { service, repository: freshRepo } = await createService();
    try {
      expect(service.getState().ready).toBe(true);
      expectV1(service);
    } finally {
      freshRepo.close();
      await deleteDatabase();
    }
    repository = await createRepository();
  });
});
