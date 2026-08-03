import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ContentService } from '../src/services/contentService';
import { ContentRepository } from '../src/storage/repository';
import {
  QuotaExceededStorageError,
  STORE_META,
  STORE_PACKS,
  STORE_SETTINGS,
  openDatabase,
  txn,
  transactionToPromise,
} from '../src/storage/db';
import type { ContentRepository as ContentRepositoryType } from '../src/storage/repository';
import type { PersistedSettings } from '../src/types';
import {
  createRepository,
  deleteDatabase,
  expectedV2Checksum,
  loadV2Bytes,
  materializeV2,
  bytesDownloader,
  seedPack,
} from './helpers';

let repository: ContentRepositoryType;

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

describe('round 3: atomic settings + pack migration', () => {
  it('writes v2 settings and v2 pack pointer in the same commit transaction', async () => {
    const service = await freshService();

    await service.updateSettings({
      fontSize: 'large',
      theme: 'dark',
      lineSpacing: 'spacious',
    });

    const v2 = materializeV2(seedPack());
    await repository.stage(v2);

    const migratedSettings: PersistedSettings = {
      schemaVersion: 2,
      settings: { fontSize: 'large', theme: 'dark', lineSpacing: 'spacious' },
    };
    await repository.commit(v2, '2026.07.31', migratedSettings);

    expect(await repository.getActiveVersion()).toBe('2026.09.01');

    const saved = await repository.loadPersistedSettings();
    expect(saved?.schemaVersion).toBe(2);
    expect(saved?.settings).toEqual({
      fontSize: 'large',
      theme: 'dark',
      lineSpacing: 'spacious',
    });

    const loaded = await repository.loadSettings();
    expect(loaded).toEqual({
      fontSize: 'large',
      theme: 'dark',
      lineSpacing: 'spacious',
    });
  });

  it('preserves v1 settings + v1 pack when commit is interrupted (simulated forced restart)', async () => {
    const service = await freshService();

    await service.updateSettings({
      fontSize: 'small',
      theme: 'light',
      lineSpacing: 'compact',
    });

    const persistedBefore = await repository.loadPersistedSettings();
    expect(persistedBefore?.schemaVersion).toBe(1);

    const v2 = materializeV2(seedPack());
    await repository.stage(v2);

    const realDb = await openDatabase();
    try {
      const transaction = txn(
        realDb,
        [STORE_META, STORE_SETTINGS, STORE_PACKS],
        'readwrite',
      );
      const metaStore = transaction.objectStore(STORE_META);
      metaStore.put({ key: 'activeVersion', value: '2026.09.01' });
      metaStore.put({ key: 'previousVersion', value: '2026.07.31' });
      metaStore.delete('stagedVersion');
      transaction.abort();
      await new Promise<void>((resolve) => {
        transaction.onabort = () => resolve();
        transaction.onerror = () => resolve();
      });
    } finally {
      realDb.close();
    }

    expect(await repository.getActiveVersion()).toBe('2026.07.31');
    expect(await repository.getStagedVersion()).toBe('2026.09.01');

    const persistedAfter = await repository.loadPersistedSettings();
    expect(persistedAfter?.schemaVersion).toBe(1);
    expect(persistedAfter?.settings).toEqual({
      fontSize: 'small',
      theme: 'light',
      lineSpacing: 'compact',
    });

    const loaded = await repository.loadSettings();
    expect(loaded).toEqual({
      fontSize: 'small',
      theme: 'light',
      lineSpacing: 'compact',
    });
  });

  it('recovers to complete old pack + old settings after restart with staged v2', async () => {
    const service = await freshService();
    await service.updateSettings({
      fontSize: 'large',
      theme: 'dark',
      lineSpacing: 'spacious',
    });

    await repository.stage(materializeV2(seedPack()));
    expect(await repository.getStagedVersion()).toBe('2026.09.01');

    repository.close();
    const restartedRepo = await ContentRepository.open();
    const restarted = new ContentService(restartedRepo);
    await restarted.initialize(seedPack());

    try {
      const state = restarted.getState();
      expect(state.pack?.packageVersion).toBe('2026.07.31');
      expect(state.settings).toEqual({
        fontSize: 'large',
        theme: 'dark',
        lineSpacing: 'spacious',
      });
      expect(await restartedRepo.getStagedVersion()).toBeNull();
      expect(await restartedRepo.getPack('2026.09.01')).toBeNull();
    } finally {
      restartedRepo.close();
    }
    repository = await createRepository();
  });

  it('loads v2 settings after successful v2 commit through service', async () => {
    const service = await freshService();
    await service.updateSettings({
      fontSize: 'xlarge',
      theme: 'high-contrast',
      lineSpacing: 'spacious',
    });

    await service.checkUpdate('/content-pack-v2.json', {
      expectedChecksum: await expectedV2Checksum(),
      downloader: bytesDownloader(loadV2Bytes()),
    });

    expect(service.getState().pack?.packageVersion).toBe('2026.09.01');
    expect(service.getState().settings).toEqual({
      fontSize: 'xlarge',
      theme: 'high-contrast',
      lineSpacing: 'spacious',
    });

    const persisted = await repository.loadPersistedSettings();
    expect(persisted?.schemaVersion).toBe(2);
  });
});

describe('round 3: settings schema mismatch detection', () => {
  it('falls back to defaults when v2 settings are stored but v1 pack is active', async () => {
    await repository.initialize(seedPack());

    const db = await openDatabase();
    try {
      const transaction = txn(db, [STORE_SETTINGS], 'readwrite');
      transaction.objectStore(STORE_SETTINGS).put({
        key: 'reading',
        value: {
          schemaVersion: 2,
          settings: {
            fontSize: 'xlarge',
            theme: 'high-contrast',
            lineSpacing: 'spacious',
          },
        },
      });
      await transactionToPromise(transaction);
    } finally {
      db.close();
    }

    const loaded = await repository.loadSettings();
    expect(loaded).toEqual({
      fontSize: 'medium',
      theme: 'light',
      lineSpacing: 'normal',
    });
  });

  it('falls back to defaults when v1 settings are stored but v2 pack is active', async () => {
    const v2 = materializeV2(seedPack());
    await repository.initialize(seedPack());
    await repository.stage(v2);
    await repository.commit(v2, '2026.07.31', {
      schemaVersion: 2,
      settings: {
        fontSize: 'large',
        theme: 'dark',
        lineSpacing: 'spacious',
      },
    });

    const db = await openDatabase();
    try {
      const transaction = txn(db, [STORE_SETTINGS], 'readwrite');
      transaction.objectStore(STORE_SETTINGS).put({
        key: 'reading',
        value: {
          schemaVersion: 1,
          settings: {
            fontSize: 'small',
            theme: 'light',
            lineSpacing: 'compact',
          },
        },
      });
      await transactionToPromise(transaction);
    } finally {
      db.close();
    }

    const loaded = await repository.loadSettings();
    expect(loaded).toEqual({
      fontSize: 'medium',
      theme: 'light',
      lineSpacing: 'normal',
    });
  });
});

describe('round 3: quota exhaustion during settings save', () => {
  it('keeps new settings in-memory for the session but preserves last saved settings in DB', async () => {
    const service = await freshService();
    await service.updateSettings({
      fontSize: 'medium',
      theme: 'light',
      lineSpacing: 'normal',
    });

    const failing = Object.create(repository) as ContentRepositoryType;
    failing.saveSettings = async () => {
      throw new QuotaExceededStorageError('simulated quota');
    };
    const quotaService = new ContentService(failing);
    await quotaService.initialize(seedPack());

    await quotaService.updateSettings({
      fontSize: 'xlarge',
      theme: 'high-contrast',
      lineSpacing: 'spacious',
    });

    expect(quotaService.getState().settings).toEqual({
      fontSize: 'xlarge',
      theme: 'high-contrast',
      lineSpacing: 'spacious',
    });
    expect(quotaService.getState().degradedNotice).toContain('存储空间不足');

    const persisted = await repository.loadPersistedSettings();
    expect(persisted?.settings).toEqual({
      fontSize: 'medium',
      theme: 'light',
      lineSpacing: 'normal',
    });
  });

  it('rolls back in-memory settings on non-quota errors', async () => {
    const service = await freshService();
    await service.updateSettings({
      fontSize: 'medium',
      theme: 'light',
      lineSpacing: 'normal',
    });

    const failing = Object.create(repository) as ContentRepositoryType;
    failing.saveSettings = async () => {
      throw new Error('unexpected storage error');
    };
    const errorService = new ContentService(failing);
    await errorService.initialize(seedPack());

    await expect(
      errorService.updateSettings({
        fontSize: 'xlarge',
        theme: 'high-contrast',
        lineSpacing: 'spacious',
      }),
    ).rejects.toThrow('unexpected storage error');

    expect(errorService.getState().settings).toEqual({
      fontSize: 'medium',
      theme: 'light',
      lineSpacing: 'normal',
    });
    expect(errorService.getState().degradedNotice).toBeNull();
  });
});

describe('round 3: saveSettings auto-detects schema from active pack', () => {
  it('saves v1 schema when v1 pack is active', async () => {
    await repository.initialize(seedPack());
    await repository.saveSettings({
      fontSize: 'large',
      theme: 'dark',
      lineSpacing: 'compact',
    });

    const persisted = await repository.loadPersistedSettings();
    expect(persisted?.schemaVersion).toBe(1);
  });

  it('saves v2 schema when v2 pack is active', async () => {
    const v2 = materializeV2(seedPack());
    await repository.initialize(seedPack());
    await repository.stage(v2);
    await repository.commit(v2, '2026.07.31', {
      schemaVersion: 2,
      settings: {
        fontSize: 'medium',
        theme: 'light',
        lineSpacing: 'normal',
      },
    });

    await repository.saveSettings({
      fontSize: 'xlarge',
      theme: 'high-contrast',
      lineSpacing: 'spacious',
    });

    const persisted = await repository.loadPersistedSettings();
    expect(persisted?.schemaVersion).toBe(2);
  });
});
