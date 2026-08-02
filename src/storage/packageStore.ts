/**
 * Offline storage layer. Owns the IndexedDB schema and the *atomic* package
 * switch. Two object stores:
 *
 *  - `packages`  keyPath "packageVersion" — one fully resolved+indexed
 *                snapshot per version.
 *  - `meta`      keyPath "key" — holds the single "active" pointer and the
 *                reading "settings". The active pointer is what makes a version
 *                visible; nothing reads a package that the pointer doesn't name.
 *
 * The switch is atomic because writing the new package AND advancing the active
 * pointer happen inside one read/write transaction spanning both stores. If the
 * transaction aborts for any reason (download/checksum aborted earlier so we
 * never reach here, quota exceeded mid-write, tab closed before commit) the
 * pointer keeps naming the previous complete version. Restart therefore always
 * shows a complete old package or a complete new package — never a mix.
 */
import type { ReadingSettings, StoredPackage } from '../core/types';
import { DEFAULT_READING_SETTINGS } from '../core/types';
import { awaitRequest, openDatabase, runTransaction } from './idb';

export const DB_NAME = 'rights-pocket-guide';
export const DB_VERSION = 1;
const STORE_PACKAGES = 'packages';
const STORE_META = 'meta';
const KEY_ACTIVE = 'active';
const KEY_SETTINGS = 'settings';

interface ActiveRecord {
  readonly key: typeof KEY_ACTIVE;
  readonly packageVersion: string;
}

interface SettingsRecord {
  readonly key: typeof KEY_SETTINGS;
  readonly value: ReadingSettings;
}

function isActiveRecord(value: unknown): value is ActiveRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { key?: unknown }).key === KEY_ACTIVE &&
    typeof (value as { packageVersion?: unknown }).packageVersion === 'string'
  );
}

function isSettingsRecord(value: unknown): value is SettingsRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { key?: unknown }).key === KEY_SETTINGS &&
    typeof (value as { value?: unknown }).value === 'object' &&
    (value as { value?: unknown }).value !== null
  );
}

export class PackageStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<PackageStore> {
    const db = await openDatabase(DB_NAME, DB_VERSION, (database) => {
      if (!database.objectStoreNames.contains(STORE_PACKAGES)) {
        database.createObjectStore(STORE_PACKAGES, {
          keyPath: 'packageVersion',
        });
      }
      if (!database.objectStoreNames.contains(STORE_META)) {
        database.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    });
    return new PackageStore(db);
  }

  close(): void {
    this.db.close();
  }

  /** The version the active pointer names, or undefined on a fresh install. */
  async getActiveVersion(): Promise<string | undefined> {
    return runTransaction(this.db, [STORE_META], 'readonly', async (tx) => {
      const record = await awaitRequest<unknown>(
        tx.objectStore(STORE_META).get(KEY_ACTIVE),
      );
      return isActiveRecord(record) ? record.packageVersion : undefined;
    });
  }

  /** Load the currently active, complete package (or undefined). */
  async getActivePackage(): Promise<StoredPackage | undefined> {
    return runTransaction(
      this.db,
      [STORE_META, STORE_PACKAGES],
      'readonly',
      async (tx) => {
        const active = await awaitRequest<unknown>(
          tx.objectStore(STORE_META).get(KEY_ACTIVE),
        );
        if (!isActiveRecord(active)) {
          return undefined;
        }
        const pkg = await awaitRequest<unknown>(
          tx.objectStore(STORE_PACKAGES).get(active.packageVersion),
        );
        return (pkg as StoredPackage | undefined) ?? undefined;
      },
    );
  }

  async getPackage(version: string): Promise<StoredPackage | undefined> {
    return runTransaction(
      this.db,
      [STORE_PACKAGES],
      'readonly',
      async (tx) => {
        const pkg = await awaitRequest<unknown>(
          tx.objectStore(STORE_PACKAGES).get(version),
        );
        return (pkg as StoredPackage | undefined) ?? undefined;
      },
    );
  }

  async listVersions(): Promise<string[]> {
    return runTransaction(this.db, [STORE_PACKAGES], 'readonly', async (tx) => {
      const keys = await awaitRequest<IDBValidKey[]>(
        tx.objectStore(STORE_PACKAGES).getAllKeys(),
      );
      return keys.filter((k): k is string => typeof k === 'string').sort();
    });
  }

  /**
   * Atomically install a package and make it active in a single transaction.
   * Either both the package write and the pointer advance commit, or neither
   * does. A quota error while writing the (potentially large) package aborts
   * the whole transaction, leaving the previous active version fully intact.
   */
  async commitActivePackage(pkg: StoredPackage): Promise<void> {
    await runTransaction(
      this.db,
      [STORE_PACKAGES, STORE_META],
      'readwrite',
      async (tx) => {
        // Write the full snapshot first; if this exceeds quota the transaction
        // aborts before the pointer is touched.
        await awaitRequest(tx.objectStore(STORE_PACKAGES).put(pkg));
        const active: ActiveRecord = {
          key: KEY_ACTIVE,
          packageVersion: pkg.packageVersion,
        };
        await awaitRequest(tx.objectStore(STORE_META).put(active));
      },
    );
  }

  /**
   * Remove packages that are not the active version. Safe to call after a
   * successful switch; runs in its own transaction so a failure here never
   * affects the active pointer.
   */
  async pruneInactive(): Promise<void> {
    const active = await this.getActiveVersion();
    if (active === undefined) {
      return;
    }
    await runTransaction(this.db, [STORE_PACKAGES], 'readwrite', async (tx) => {
      const store = tx.objectStore(STORE_PACKAGES);
      const keys = await awaitRequest<IDBValidKey[]>(store.getAllKeys());
      for (const key of keys) {
        if (key !== active) {
          await awaitRequest(store.delete(key));
        }
      }
    });
  }

  async getSettings(): Promise<ReadingSettings> {
    return runTransaction(this.db, [STORE_META], 'readonly', async (tx) => {
      const record = await awaitRequest<unknown>(
        tx.objectStore(STORE_META).get(KEY_SETTINGS),
      );
      return isSettingsRecord(record) ? record.value : DEFAULT_READING_SETTINGS;
    });
  }

  async saveSettings(settings: ReadingSettings): Promise<void> {
    await runTransaction(this.db, [STORE_META], 'readwrite', async (tx) => {
      const record: SettingsRecord = { key: KEY_SETTINGS, value: settings };
      await awaitRequest(tx.objectStore(STORE_META).put(record));
    });
  }
}
