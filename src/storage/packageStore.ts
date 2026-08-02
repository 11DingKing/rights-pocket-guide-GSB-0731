import type { ContentPackage } from "../core/types";
import type { SearchIndex } from "../core/search";
import { mapIdbError, requestToPromise, runInTransaction } from "./idb";
import {
  META_ACTIVE_VERSION,
  META_PREVIOUS_VERSION,
  STORE_META,
  STORE_PACKAGES,
  openGuideDatabase,
} from "./database";

export type PackageStatus = "staged" | "active" | "retained";

/**
 * 落库的内容包记录：内容与检索索引作为整体写入，
 * 视图永远只读 status === 'active' 的那一份，因此不会看到新旧混合。
 */
export interface StoredPackage {
  version: string;
  status: PackageStatus;
  pack: ContentPackage;
  index: SearchIndex;
  storedAt: string;
}

function asStoredPackage(value: unknown): StoredPackage | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as StoredPackage;
  if (
    typeof record.version !== "string" ||
    typeof record.storedAt !== "string"
  ) {
    return undefined;
  }
  if (
    record.status !== "staged" &&
    record.status !== "active" &&
    record.status !== "retained"
  ) {
    return undefined;
  }
  if (typeof record.pack !== "object" || record.pack === null) {
    return undefined;
  }
  if (typeof record.index !== "object" || record.index === null) {
    return undefined;
  }
  return record;
}

export class PackageStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<PackageStore> {
    return new PackageStore(await openGuideDatabase());
  }

  /** 测试用：包一层已有的 db 连接。 */
  static fromDatabase(db: IDBDatabase): PackageStore {
    return new PackageStore(db);
  }

  close(): void {
    this.db.close();
  }

  private async readMeta(key: string): Promise<string | null> {
    const value = await runInTransaction(
      this.db,
      [STORE_META],
      "readonly",
      async (tx) => requestToPromise(tx.objectStore(STORE_META).get(key)),
    );
    return typeof value === "string" ? value : null;
  }

  async getActiveVersion(): Promise<string | null> {
    return this.readMeta(META_ACTIVE_VERSION);
  }

  async getPreviousVersion(): Promise<string | null> {
    return this.readMeta(META_PREVIOUS_VERSION);
  }

  async getPackage(version: string): Promise<StoredPackage | undefined> {
    const value = await runInTransaction(
      this.db,
      [STORE_PACKAGES],
      "readonly",
      async (tx) =>
        requestToPromise(tx.objectStore(STORE_PACKAGES).get(version)),
    );
    return asStoredPackage(value);
  }

  /** 暂存：完整写入新包（含索引），状态 staged。此刻激活指针不变。 */
  async stagePackage(record: StoredPackage): Promise<void> {
    const staged: StoredPackage = { ...record, status: "staged" };
    await runInTransaction(
      this.db,
      [STORE_PACKAGES],
      "readwrite",
      async (tx) => {
        await requestToPromise(tx.objectStore(STORE_PACKAGES).put(staged));
      },
    );
  }

  /**
   * 原子切换：单个事务内完成 —— 新包 staged→active、旧包 active→retained、
   * 激活指针翻转。提交前崩溃/失败 ⇒ 事务回滚 ⇒ 旧版本完整保留。
   */
  async activateStaged(
    version: string,
  ): Promise<{ previousVersion: string | null }> {
    return runInTransaction(
      this.db,
      [STORE_PACKAGES, STORE_META],
      "readwrite",
      async (tx) => {
        const packages = tx.objectStore(STORE_PACKAGES);
        const meta = tx.objectStore(STORE_META);
        const staged = asStoredPackage(
          await requestToPromise(packages.get(version)),
        );
        if (staged === undefined || staged.status !== "staged") {
          throw new Error(`没有可激活的暂存包 ${version}`);
        }
        const currentRaw = await requestToPromise(
          meta.get(META_ACTIVE_VERSION),
        );
        const currentVersion =
          typeof currentRaw === "string" ? currentRaw : null;
        if (currentVersion !== null && currentVersion !== version) {
          const current = asStoredPackage(
            await requestToPromise(packages.get(currentVersion)),
          );
          if (current !== undefined) {
            await requestToPromise(
              packages.put({ ...current, status: "retained" }),
            );
          }
        }
        await requestToPromise(packages.put({ ...staged, status: "active" }));
        await requestToPromise(meta.put(version, META_ACTIVE_VERSION));
        if (currentVersion !== null && currentVersion !== version) {
          await requestToPromise(
            meta.put(currentVersion, META_PREVIOUS_VERSION),
          );
        }
        return { previousVersion: currentVersion };
      },
    );
  }

  /** 清理未被激活的暂存包（更新失败或崩溃后的启动清理）。 */
  async discardStaged(): Promise<void> {
    await runInTransaction(
      this.db,
      [STORE_PACKAGES],
      "readwrite",
      async (tx) => {
        const store = tx.objectStore(STORE_PACKAGES);
        const all = await requestToPromise(store.getAll());
        for (const item of all) {
          const record = asStoredPackage(item);
          if (record !== undefined && record.status === "staged") {
            await requestToPromise(store.delete(record.version));
          }
        }
      },
    );
  }

  /** 首次安装（种子包）：直接写为 active。单事务。 */
  async installInitial(record: StoredPackage): Promise<void> {
    const active: StoredPackage = { ...record, status: "active" };
    await runInTransaction(
      this.db,
      [STORE_PACKAGES, STORE_META],
      "readwrite",
      async (tx) => {
        await requestToPromise(tx.objectStore(STORE_PACKAGES).put(active));
        await requestToPromise(
          tx.objectStore(STORE_META).put(record.version, META_ACTIVE_VERSION),
        );
      },
    );
  }

  /**
   * 回滚到上一个保留版本：单事务内交换 active/retained 并翻转指针。
   * 没有可回滚版本时返回 null。
   */
  async rollbackToPrevious(): Promise<string | null> {
    return runInTransaction(
      this.db,
      [STORE_PACKAGES, STORE_META],
      "readwrite",
      async (tx) => {
        const packages = tx.objectStore(STORE_PACKAGES);
        const meta = tx.objectStore(STORE_META);
        const currentRaw = await requestToPromise(
          meta.get(META_ACTIVE_VERSION),
        );
        const previousRaw = await requestToPromise(
          meta.get(META_PREVIOUS_VERSION),
        );
        const currentVersion =
          typeof currentRaw === "string" ? currentRaw : null;
        const previousVersion =
          typeof previousRaw === "string" ? previousRaw : null;
        if (currentVersion === null || previousVersion === null) {
          return null;
        }
        const current = asStoredPackage(
          await requestToPromise(packages.get(currentVersion)),
        );
        const previous = asStoredPackage(
          await requestToPromise(packages.get(previousVersion)),
        );
        if (current === undefined || previous === undefined) {
          return null;
        }
        await requestToPromise(
          packages.put({ ...current, status: "retained" }),
        );
        await requestToPromise(packages.put({ ...previous, status: "active" }));
        await requestToPromise(meta.put(previousVersion, META_ACTIVE_VERSION));
        await requestToPromise(meta.put(currentVersion, META_PREVIOUS_VERSION));
        return previousVersion;
      },
    );
  }

  /**
   * 启动一致性读取：只返回“完整的激活包”。
   * 指针损坏时尝试回退到保留版本；两者都不可用则返回 null（触发重新播种）。
   */
  async readConsistentActive(): Promise<StoredPackage | null> {
    const activeVersion = await this.getActiveVersion();
    if (activeVersion !== null) {
      const active = await this.getPackage(activeVersion);
      if (active !== undefined && active.status === "active") {
        return active;
      }
      const previousVersion = await this.getPreviousVersion();
      if (previousVersion !== null) {
        const previous = await this.getPackage(previousVersion);
        if (previous !== undefined) {
          const healed = await this.rollbackToPrevious();
          if (healed !== null) {
            return this.getPackage(healed).then((record) => record ?? null);
          }
        }
      }
      return null;
    }
    return null;
  }
}

export { mapIdbError };
