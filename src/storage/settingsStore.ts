import type { ReadingSettingsState } from "../core/settingsSchema";
import { requestToPromise, runInTransaction } from "./idb";
import {
  SETTINGS_KEY_BACKUP,
  SETTINGS_KEY_CURRENT,
  STORE_SETTINGS,
  openGuideDatabase,
} from "./database";

/**
 * 阅读设置存储：双记录（current / backup）原始读写。
 * 校验与 schema 迁移在 core/settingsSchema.ts；与内容包的原子写入
 * 由 packageStore 的跨仓事务完成（本类只负责同 schema 的偏好修改）。
 */
export class SettingsStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<SettingsStore> {
    return new SettingsStore(await openGuideDatabase());
  }

  static fromDatabase(db: IDBDatabase): SettingsStore {
    return new SettingsStore(db);
  }

  /** 原始读取两条记录（不做校验，交由上层按所需 schema 判定）。 */
  async readRaw(): Promise<{ current: unknown; backup: unknown }> {
    return runInTransaction(
      this.db,
      [STORE_SETTINGS],
      "readonly",
      async (tx) => {
        const store = tx.objectStore(STORE_SETTINGS);
        const current = await requestToPromise(store.get(SETTINGS_KEY_CURRENT));
        const backup = await requestToPromise(store.get(SETTINGS_KEY_BACKUP));
        return { current, backup };
      },
    );
  }

  /** 写入当前设置（同 schema 的偏好修改；backup 不动，留给跨版本回滚）。 */
  async writeCurrent(state: ReadingSettingsState): Promise<void> {
    await runInTransaction(
      this.db,
      [STORE_SETTINGS],
      "readwrite",
      async (tx) => {
        await requestToPromise(
          tx.objectStore(STORE_SETTINGS).put(state, SETTINGS_KEY_CURRENT),
        );
      },
    );
  }

  /** 启动修复：用抢救出的状态覆盖 current（backup 保持不动）。 */
  async repairCurrent(state: ReadingSettingsState): Promise<void> {
    await this.writeCurrent(state);
  }
}
