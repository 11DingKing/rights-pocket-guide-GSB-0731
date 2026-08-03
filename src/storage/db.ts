export class StorageError extends Error {
  readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'StorageError';
    this.cause = cause;
  }
}

export class QuotaExceededStorageError extends StorageError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'QuotaExceededStorageError';
  }
}

export class UpdateConflictError extends StorageError {
  readonly currentVersion: string;
  readonly expectedBaseVersion: string;
  constructor(currentVersion: string, expectedBaseVersion: string) {
    super(
      `提交冲突：当前活动版本为 ${currentVersion}，预期基础版本为 ${expectedBaseVersion}`,
    );
    this.name = 'UpdateConflictError';
    this.currentVersion = currentVersion;
    this.expectedBaseVersion = expectedBaseVersion;
  }
}

const DB_NAME = 'rights-pocket-guide';
const DB_VERSION = 3;

export const STORE_PACKS = 'packs';
export const STORE_META = 'meta';
export const STORE_SETTINGS = 'settings';

export function openDatabase(
  factory: IDBFactory = indexedDB,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE_PACKS)) {
        db.deleteObjectStore(STORE_PACKS);
      }
      db.createObjectStore(STORE_PACKS, { keyPath: 'packageVersion' });
      if (db.objectStoreNames.contains(STORE_META)) {
        db.deleteObjectStore(STORE_META);
      }
      db.createObjectStore(STORE_META, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new StorageError('无法打开 IndexedDB', request.error));
  });
}

type TransactionMode = 'readonly' | 'readwrite';

export function txn(
  db: IDBDatabase,
  stores: ReadonlyArray<string>,
  mode: TransactionMode,
): IDBTransaction {
  return db.transaction(stores as string[], mode);
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      const error = request.error;
      if (error !== null && isQuotaError(error)) {
        reject(new QuotaExceededStorageError('存储空间不足', error));
      } else {
        reject(new StorageError('数据库请求失败', error));
      }
    };
  });
}

export function transactionToPromise(
  transaction: IDBTransaction,
): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      const error = transaction.error;
      if (error !== null && isQuotaError(error)) {
        reject(new QuotaExceededStorageError('存储空间不足，事务已回滚', error));
      } else {
        reject(new StorageError('事务失败', error));
      }
    };
    transaction.onabort = () => {
      const error = transaction.error;
      if (error !== null && isQuotaError(error)) {
        reject(new QuotaExceededStorageError('事务已中止：存储空间不足', error));
      } else {
        reject(new StorageError('事务已中止', error));
      }
    };
  });
}

function isQuotaError(error: DOMException): boolean {
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'QuotaExceededErr' ||
    error.code === 22
  );
}
