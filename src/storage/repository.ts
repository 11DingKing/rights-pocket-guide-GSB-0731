import type { MaterializedPack, ReadingSettings } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import {
  QuotaExceededStorageError,
  STORE_META,
  STORE_PACKS,
  STORE_SETTINGS,
  StorageError,
  UpdateConflictError,
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
    await this.cleanupOrphanPacks();
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

  private async cleanupOrphanPacks(): Promise<void> {
    const [active, previous, staged] = await Promise.all([
      this.getActiveVersion(),
      this.getPreviousVersion(),
      this.getStagedVersion(),
    ]);
    const keep = new Set<string>();
    for (const version of [active, previous, staged]) {
      if (version !== null) keep.add(version);
    }
    const transaction = txn(this.db, [STORE_PACKS], 'readonly');
    const allVersions = await requestToPromise(
      transaction.objectStore(STORE_PACKS).getAllKeys() as IDBRequest<
        IDBValidKey[]
      >,
    );
    await transactionToPromise(transaction);

    const orphans = allVersions
      .map((key) => (typeof key === 'string' ? key : null))
      .filter((key): key is string => key !== null && !keep.has(key));

    if (orphans.length === 0) return;

    const deleteTransaction = txn(this.db, [STORE_PACKS], 'readwrite');
    for (const version of orphans) {
      deleteTransaction.objectStore(STORE_PACKS).delete(version);
    }
    await transactionToPromise(deleteTransaction);
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

  async commit(
    pack: MaterializedPack,
    expectedBaseVersion: string,
  ): Promise<void> {
    const stagedVersion = await this.getStagedVersion();
    if (stagedVersion !== pack.packageVersion) {
      throw new StorageError(
        `提交失败：版本 ${pack.packageVersion} 尚未完成暂存`,
      );
    }

    await new Promise<void>((resolve, reject) => {
      const transaction = txn(this.db, [STORE_META], 'readwrite');
      const metaStore = transaction.objectStore(STORE_META);
      let conflict: UpdateConflictError | null = null;
      let missingStaged = false;

      const activeRequest = metaStore.get(META_ACTIVE) as IDBRequest<
        MetaEntry | undefined
      >;
      activeRequest.onsuccess = () => {
        const current = activeRequest.result?.value ?? null;
        if (current !== expectedBaseVersion) {
          conflict = new UpdateConflictError(
            current ?? '(无)',
            expectedBaseVersion,
          );
          transaction.abort();
          return;
        }
        const stagedRequest = metaStore.get(META_STAGED) as IDBRequest<
          MetaEntry | undefined
        >;
        stagedRequest.onsuccess = () => {
          if (stagedRequest.result?.value !== pack.packageVersion) {
            missingStaged = true;
            transaction.abort();
            return;
          }
          const activeMeta: MetaEntry = {
            key: META_ACTIVE,
            value: pack.packageVersion,
          };
          metaStore.put(activeMeta);
          const previousMeta: MetaEntry = {
            key: META_PREVIOUS,
            value: expectedBaseVersion,
          };
          metaStore.put(previousMeta);
          metaStore.delete(META_STAGED);
        };
        stagedRequest.onerror = () => {
          transaction.abort();
        };
      };
      activeRequest.onerror = () => transaction.abort();

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        reject(
          conflict ??
            new StorageError('事务失败', transaction.error),
        );
      };
      transaction.onabort = () => {
        if (conflict !== null) {
          reject(conflict);
          return;
        }
        if (missingStaged) {
          reject(
            new StorageError(
              `提交失败：版本 ${pack.packageVersion} 的暂存已被其他进程移除`,
            ),
          );
          return;
        }
        reject(
          new StorageError(
            '事务已中止',
            transaction.error,
          ),
        );
      };
    });
  }

  async discardStaging(): Promise<void> {
    const stagedVersion = await this.getStagedVersion();
    if (stagedVersion === null) return;
    const activeVersion = await this.getActiveVersion();
    if (activeVersion === stagedVersion) return;
    const transaction = txn(
      this.db,
      [STORE_PACKS, STORE_META],
      'readwrite',
    );
    transaction.objectStore(STORE_PACKS).delete(stagedVersion);
    transaction.objectStore(STORE_META).delete(META_STAGED);
    await transactionToPromise(transaction);
  }

  async discardStagedCandidate(version: string): Promise<void> {
    const [activeVersion, stagedVersion] = await Promise.all([
      this.getActiveVersion(),
      this.getStagedVersion(),
    ]);
    if (activeVersion === version) return;

    const transaction = txn(
      this.db,
      [STORE_PACKS, STORE_META],
      'readwrite',
    );
    transaction.objectStore(STORE_PACKS).delete(version);
    if (stagedVersion === version) {
      transaction.objectStore(STORE_META).delete(META_STAGED);
    }
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
