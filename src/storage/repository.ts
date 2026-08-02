import type { MaterializedPack, ReadingSettings } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import {
  QuotaExceededStorageError,
  STORE_META,
  STORE_PACKS,
  STORE_SETTINGS,
  StorageError,
  openDatabase,
  requestToPromise,
  transactionToPromise,
  txn,
} from './db';

const META_ACTIVE = 'activeVersion';
const META_STAGED = 'stagedVersion';
const META_PREVIOUS = 'previousVersion';
const SETTINGS_KEY = 'reading';

interface MetaEntry {
  readonly key: string;
  readonly value: string;
}

interface SettingsEntry {
  readonly key: string;
  readonly value: ReadingSettings;
}

export class ContentRepository {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<ContentRepository> {
    const db = await openDatabase();
    return new ContentRepository(db);
  }

  async initialize(seed: MaterializedPack): Promise<void> {
    await this.cleanupInterruptedStaging();
    const active = await this.getActiveVersion();
    if (active === null) {
      await this.seedFirstVersion(seed);
    }
  }

  private async cleanupInterruptedStaging(): Promise<void> {
    const stagedVersion = await this.getMeta(META_STAGED);
    if (stagedVersion === null) return;
    const transaction = txn(
      this.db,
      [STORE_PACKS, STORE_META],
      'readwrite',
    );
    transaction.objectStore(STORE_PACKS).delete(stagedVersion);
    transaction.objectStore(STORE_META).delete(META_STAGED);
    await transactionToPromise(transaction);
  }

  private async seedFirstVersion(seed: MaterializedPack): Promise<void> {
    const transaction = txn(
      this.db,
      [STORE_PACKS, STORE_META],
      'readwrite',
    );
    transaction.objectStore(STORE_PACKS).put(seed);
    const activeMeta: MetaEntry = {
      key: META_ACTIVE,
      value: seed.packageVersion,
    };
    transaction.objectStore(STORE_META).put(activeMeta);
    await transactionToPromise(transaction);
  }

  async getActiveVersion(): Promise<string | null> {
    return this.getMeta(META_ACTIVE);
  }

  async getPreviousVersion(): Promise<string | null> {
    return this.getMeta(META_PREVIOUS);
  }

  async getStagedVersion(): Promise<string | null> {
    return this.getMeta(META_STAGED);
  }

  private async getMeta(key: string): Promise<string | null> {
    const transaction = txn(this.db, [STORE_META], 'readonly');
    const result = await requestToPromise(
      transaction.objectStore(STORE_META).get(key) as IDBRequest<
        MetaEntry | undefined
      >,
    );
    await transactionToPromise(transaction);
    return result?.value ?? null;
  }

  async getActivePack(): Promise<MaterializedPack | null> {
    const version = await this.getActiveVersion();
    if (version === null) return null;
    return this.getPack(version);
  }

  async getPack(version: string): Promise<MaterializedPack | null> {
    const transaction = txn(this.db, [STORE_PACKS], 'readonly');
    const result = await requestToPromise(
      transaction.objectStore(STORE_PACKS).get(version) as IDBRequest<
        MaterializedPack | undefined
      >,
    );
    await transactionToPromise(transaction);
    return result ?? null;
  }

  async stage(pack: MaterializedPack): Promise<void> {
    const transaction = txn(
      this.db,
      [STORE_PACKS, STORE_META],
      'readwrite',
    );
    transaction.objectStore(STORE_PACKS).put(pack);
    const stagedMeta: MetaEntry = {
      key: META_STAGED,
      value: pack.packageVersion,
    };
    transaction.objectStore(STORE_META).put(stagedMeta);
    try {
      await transactionToPromise(transaction);
    } catch (error) {
      if (error instanceof QuotaExceededStorageError) {
        throw error;
      }
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError('暂存内容包失败', error);
    }
  }

  async commit(pack: MaterializedPack): Promise<void> {
    const currentVersion = await this.getActiveVersion();
    if (currentVersion === null) {
      throw new StorageError('提交失败：当前没有可用的活动版本');
    }
    const stagedVersion = await this.getStagedVersion();
    if (stagedVersion !== pack.packageVersion) {
      throw new StorageError(
        `提交失败：版本 ${pack.packageVersion} 尚未完成暂存`,
      );
    }

    const transaction = txn(this.db, [STORE_META], 'readwrite');
    const metaStore = transaction.objectStore(STORE_META);
    const activeMeta: MetaEntry = {
      key: META_ACTIVE,
      value: pack.packageVersion,
    };
    metaStore.put(activeMeta);
    const previousMeta: MetaEntry = {
      key: META_PREVIOUS,
      value: currentVersion,
    };
    metaStore.put(previousMeta);
    metaStore.delete(META_STAGED);
    await transactionToPromise(transaction);
  }

  async discardStaging(): Promise<void> {
    const stagedVersion = await this.getStagedVersion();
    if (stagedVersion === null) return;
    const transaction = txn(
      this.db,
      [STORE_PACKS, STORE_META],
      'readwrite',
    );
    transaction.objectStore(STORE_PACKS).delete(stagedVersion);
    transaction.objectStore(STORE_META).delete(META_STAGED);
    await transactionToPromise(transaction);
  }

  async rollback(): Promise<string> {
    const previousVersion = await this.getPreviousVersion();
    if (previousVersion === null) {
      throw new StorageError('没有可回滚的历史版本');
    }
    const previousPack = await this.getPack(previousVersion);
    if (previousPack === null) {
      throw new StorageError(`历史版本 ${previousVersion} 的数据已丢失`);
    }
    const currentVersion = await this.getActiveVersion();
    const transaction = txn(this.db, [STORE_META], 'readwrite');
    const metaStore = transaction.objectStore(STORE_META);
    const activeMeta: MetaEntry = {
      key: META_ACTIVE,
      value: previousVersion,
    };
    metaStore.put(activeMeta);
    if (currentVersion !== null) {
      const newPrevious: MetaEntry = {
        key: META_PREVIOUS,
        value: currentVersion,
      };
      metaStore.put(newPrevious);
    }
    await transactionToPromise(transaction);
    return previousVersion;
  }

  async loadSettings(): Promise<ReadingSettings> {
    const transaction = txn(this.db, [STORE_SETTINGS], 'readonly');
    const result = await requestToPromise(
      transaction.objectStore(STORE_SETTINGS).get(SETTINGS_KEY) as IDBRequest<
        SettingsEntry | undefined
      >,
    );
    await transactionToPromise(transaction);
    return result?.value ?? DEFAULT_SETTINGS;
  }

  async saveSettings(settings: ReadingSettings): Promise<void> {
    const transaction = txn(this.db, [STORE_SETTINGS], 'readwrite');
    const entry: SettingsEntry = { key: SETTINGS_KEY, value: settings };
    transaction.objectStore(STORE_SETTINGS).put(entry);
    await transactionToPromise(transaction);
  }

  async deleteAll(): Promise<void> {
    const stores = [STORE_PACKS, STORE_META, STORE_SETTINGS];
    const transaction = txn(this.db, stores, 'readwrite');
    for (const store of stores) {
      transaction.objectStore(store).clear();
    }
    await transactionToPromise(transaction);
  }

  close(): void {
    this.db.close();
  }
}
