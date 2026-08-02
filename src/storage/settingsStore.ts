import { DEFAULT_READING_SETTINGS } from '../core/types';
import type { ReadingSettings } from '../core/types';
import { requestToPromise, runInTransaction } from './idb';
import { STORE_SETTINGS, openGuideDatabase } from './database';

const SETTINGS_KEY = 'reading';

function isFontScale(value: unknown): value is ReadingSettings['fontScale'] {
  return value === 'standard' || value === 'large' || value === 'xlarge';
}

function isTheme(value: unknown): value is ReadingSettings['theme'] {
  return value === 'system' || value === 'light' || value === 'dark' || value === 'contrast';
}

function isLineSpacing(value: unknown): value is ReadingSettings['lineSpacing'] {
  return value === 'standard' || value === 'loose';
}

/** 阅读设置存储：与内容包分库存放，版本切换不影响设置。 */
export class SettingsStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<SettingsStore> {
    return new SettingsStore(await openGuideDatabase());
  }

  static fromDatabase(db: IDBDatabase): SettingsStore {
    return new SettingsStore(db);
  }

  async read(): Promise<ReadingSettings> {
    const value = await runInTransaction(this.db, [STORE_SETTINGS], 'readonly', async (tx) =>
      requestToPromise(tx.objectStore(STORE_SETTINGS).get(SETTINGS_KEY))
    );
    if (typeof value !== 'object' || value === null) {
      return { ...DEFAULT_READING_SETTINGS };
    }
    const record = value as Record<string, unknown>;
    return {
      fontScale: isFontScale(record['fontScale'])
        ? record['fontScale']
        : DEFAULT_READING_SETTINGS.fontScale,
      theme: isTheme(record['theme']) ? record['theme'] : DEFAULT_READING_SETTINGS.theme,
      lineSpacing: isLineSpacing(record['lineSpacing'])
        ? record['lineSpacing']
        : DEFAULT_READING_SETTINGS.lineSpacing
    };
  }

  async write(settings: ReadingSettings): Promise<void> {
    await runInTransaction(this.db, [STORE_SETTINGS], 'readwrite', async (tx) => {
      await requestToPromise(tx.objectStore(STORE_SETTINGS).put(settings, SETTINGS_KEY));
    });
  }
}
