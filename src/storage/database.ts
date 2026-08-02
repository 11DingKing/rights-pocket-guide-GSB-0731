import { openDatabase } from "./idb";

export const DB_NAME = "rights-pocket-guide";
export const DB_VERSION = 1;
export const STORE_PACKAGES = "packages";
export const STORE_META = "meta";
export const STORE_SETTINGS = "settings";

export const META_ACTIVE_VERSION = "activeVersion";
export const META_PREVIOUS_VERSION = "previousVersion";

export const SETTINGS_KEY_CURRENT = "reading";
export const SETTINGS_KEY_BACKUP = "readingBackup";

export function openGuideDatabase(): Promise<IDBDatabase> {
  return openDatabase(DB_NAME, DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(STORE_PACKAGES)) {
      db.createObjectStore(STORE_PACKAGES, { keyPath: "version" });
    }
    if (!db.objectStoreNames.contains(STORE_META)) {
      db.createObjectStore(STORE_META);
    }
    if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
      db.createObjectStore(STORE_SETTINGS);
    }
  });
}
