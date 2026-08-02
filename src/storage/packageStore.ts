/**
 * Offline storage layer. Owns the IndexedDB schema and the *atomic* package
 * switch. Three object stores:
 *
 *  - `packages`  keyPath "packageVersion" — committed, fully resolved+indexed
 *                snapshots. Only versions reachable through the active pointer
 *                are ever read by the repository.
 *  - `staging`   keyPath "packageVersion" — work-in-progress snapshots written
 *                during an update BEFORE they are promoted. Nothing outside this
 *                module ever reads `staging`: search, deep links, and the
 *                repository only see `packages` via the active pointer. A failed
 *                update's staged chunks/index/temp metadata therefore remain
 *                invisible.
 *  - `meta`      keyPath "key" — the single "active" pointer and reading
 *                "settings".
 *
 * Atomic switch: `promoteStaged` moves a staged snapshot into `packages` AND
 * advances the active pointer inside ONE readwrite transaction spanning all
 * three stores. The promotion is a compare-and-set: it reads the current active
 * pointer inside that same transaction and aborts unless it equals the caller's
 * `expectedActive`. Because IndexedDB serializes readwrite transactions over the
 * `meta` store, two tabs racing to promote are ordered: the first advances the
 * pointer and commits; the second observes the already-advanced pointer, fails
 * its compare-and-set, and its transaction aborts. Exactly one version commits,
 * and a restart shows a complete old package or a complete new package.
 */
import type { ReadingSettings, StoredPackage } from '../core/types';
import { awaitRequest, openDatabase, runTransaction } from './idb';

export const DB_NAME = 'rights-pocket-guide';
export const DB_VERSION = 2;
const STORE_PACKAGES = 'packages';
const STORE_STAGING = 'staging';
const STORE_META = 'meta';
const KEY_ACTIVE = 'active';
const KEY_SETTINGS = 'settings';

/** Thrown when a compare-and-set promotion loses the race (pointer moved). */
export class StalePromotionError extends Error {
  constructor(
    readonly expected: string | undefined,
    readonly found: string | undefined,
  ) {
    super(
      `Promotion lost race: expected active "${expected ?? '<none>'}" but found "${found ?? '<none>'}"`,
    );
    this.name = 'StalePromotionError';
  }
}

interface ActiveRecord {
  readonly key: typeof KEY_ACTIVE;
  readonly packageVersion: string;
}

interface SettingsRecord {
  readonly key: typeof KEY_SETTINGS;
  /** Persisted as-authored; may be from an older schema and is coerced on read. */
  readonly value: ReadingSettings;
  readonly schemaVersion: number;
}

/** A raw settings record as stored, before validation/migration. */
export interface StoredSettings {
  readonly value: ReadingSettings;
  readonly schemaVersion: number;
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
    (value as { value?: unknown }).value !== null &&
    typeof (value as { schemaVersion?: unknown }).schemaVersion === 'number'
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
      if (!database.objectStoreNames.contains(STORE_STAGING)) {
        database.createObjectStore(STORE_STAGING, {
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

  /** Versions currently sitting in staging (uncommitted work). */
  async listStaged(): Promise<string[]> {
    return runTransaction(this.db, [STORE_STAGING], 'readonly', async (tx) => {
      const keys = await awaitRequest<IDBValidKey[]>(
        tx.objectStore(STORE_STAGING).getAllKeys(),
      );
      return keys.filter((k): k is string => typeof k === 'string').sort();
    });
  }

  /**
   * Write a resolved+indexed snapshot into the isolated staging store. This is
   * safe to interrupt: staged data is never read by the repository, search, or
   * deep links, and is only made visible by a later successful `promoteStaged`.
   * A quota error here aborts the staging transaction without touching the
   * committed `packages` store or the active pointer.
   */
  async stagePackage(pkg: StoredPackage): Promise<void> {
    await runTransaction(this.db, [STORE_STAGING], 'readwrite', async (tx) => {
      await awaitRequest(tx.objectStore(STORE_STAGING).put(pkg));
    });
  }

  /**
   * Atomically promote a staged version to active with a compare-and-set on the
   * active pointer AND migrate the reading-settings schema in the same
   * transaction. In ONE transaction:
   *   1. read the current active pointer;
   *   2. abort (StalePromotionError) unless it equals `expectedActive`;
   *   3. copy the staged snapshot into `packages`;
   *   4. advance the active pointer;
   *   5. delete the staged copy;
   *   6. write the migrated settings record (value + target schema version).
   * The settings write is last: if it fails (e.g. quota exhausted while writing
   * the migrated record), the whole transaction — including the package and
   * pointer — rolls back. A forced restart therefore lands on {old package +
   * old settings} or {new package + new settings}, never a cross-version mix.
   */
  async promoteStaged(
    version: string,
    expectedActive: string | undefined,
    migratedSettings: StoredSettings,
  ): Promise<void> {
    await runTransaction(
      this.db,
      [STORE_STAGING, STORE_PACKAGES, STORE_META],
      'readwrite',
      async (tx) => {
        const meta = tx.objectStore(STORE_META);
        const current = await awaitRequest<unknown>(meta.get(KEY_ACTIVE));
        const found = isActiveRecord(current)
          ? current.packageVersion
          : undefined;
        if (found !== expectedActive) {
          // Lost the race (another tab already switched). Abort without
          // touching packages, the pointer, or settings.
          throw new StalePromotionError(expectedActive, found);
        }

        const staged = await awaitRequest<unknown>(
          tx.objectStore(STORE_STAGING).get(version),
        );
        if (staged === undefined) {
          throw new Error(`No staged package for version "${version}"`);
        }
        await awaitRequest(tx.objectStore(STORE_PACKAGES).put(staged));
        const active: ActiveRecord = {
          key: KEY_ACTIVE,
          packageVersion: version,
        };
        await awaitRequest(meta.put(active));
        await awaitRequest(tx.objectStore(STORE_STAGING).delete(version));
        // Couple the settings-schema migration to the switch. Written last so
        // its failure aborts the entire promotion.
        const settingsRecord: SettingsRecord = {
          key: KEY_SETTINGS,
          value: migratedSettings.value,
          schemaVersion: migratedSettings.schemaVersion,
        };
        await awaitRequest(meta.put(settingsRecord));
      },
    );
  }

  /** Drop all staged (uncommitted) snapshots. Never affects committed data. */
  async pruneStaging(): Promise<void> {
    await runTransaction(this.db, [STORE_STAGING], 'readwrite', async (tx) => {
      await awaitRequest(tx.objectStore(STORE_STAGING).clear());
    });
  }

  /**
   * Remove committed packages that are not the active version. Safe to call
   * after a successful switch; runs in its own transaction so a failure here
   * never affects the active pointer.
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

  /**
   * Read the raw persisted settings record (value + schema version) without
   * coercion, or undefined on a fresh install. Callers (the service/repository)
   * decide how to validate and migrate.
   */
  async getRawSettings(): Promise<StoredSettings | undefined> {
    return runTransaction(this.db, [STORE_META], 'readonly', async (tx) => {
      const record = await awaitRequest<unknown>(
        tx.objectStore(STORE_META).get(KEY_SETTINGS),
      );
      if (!isSettingsRecord(record)) {
        return undefined;
      }
      return { value: record.value, schemaVersion: record.schemaVersion };
    });
  }

  /**
   * Persist settings at a given schema version in a standalone transaction. A
   * quota failure here rejects without disturbing the package or pointer; the
   * previously persisted (last usable) settings remain intact.
   */
  async saveSettings(settings: ReadingSettings, schemaVersion: number): Promise<void> {
    await runTransaction(this.db, [STORE_META], 'readwrite', async (tx) => {
      const record: SettingsRecord = {
        key: KEY_SETTINGS,
        value: settings,
        schemaVersion,
      };
      await awaitRequest(tx.objectStore(STORE_META).put(record));
    });
  }
}
