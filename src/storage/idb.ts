/**
 * Minimal promise wrapper around the raw IndexedDB API. Kept tiny and free of
 * dependencies. Everything the app persists flows through here; React views
 * never import this module (they go through the repository/service layer).
 */

export type TransactionMode = 'readonly' | 'readwrite';

export function openDatabase(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = (): void => {
      upgrade(request.result);
    };
    request.onsuccess = (): void => {
      resolve(request.result);
    };
    request.onerror = (): void => {
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };
    request.onblocked = (): void => {
      reject(new Error('IndexedDB open blocked by another connection'));
    };
  });
}

/** Await a single request, surfacing its error (including QuotaExceededError). */
export function awaitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = (): void => {
      resolve(request.result);
    };
    request.onerror = (): void => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}

/**
 * Run a set of operations inside one transaction and resolve only once the
 * transaction has *committed*. If the transaction aborts (quota, interruption,
 * explicit abort) the returned promise rejects and nothing is persisted — this
 * is what makes the package switch atomic.
 */
export function runTransaction<T>(
  db: IDBDatabase,
  storeNames: readonly string[],
  mode: TransactionMode,
  body: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(storeNames as string[], mode);
    } catch (cause) {
      reject(cause instanceof Error ? cause : new Error(String(cause)));
      return;
    }
    let result: T;
    let settled = false;
    tx.oncomplete = (): void => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    tx.onabort = (): void => {
      if (!settled) {
        settled = true;
        reject(tx.error ?? new Error('Transaction aborted'));
      }
    };
    tx.onerror = (): void => {
      if (!settled) {
        settled = true;
        reject(tx.error ?? new Error('Transaction error'));
      }
    };
    Promise.resolve()
      .then(() => body(tx))
      .then((value) => {
        result = value;
        // Do not resolve here: wait for oncomplete so callers observe commit.
      })
      .catch((cause: unknown) => {
        // Ensure the transaction is aborted so nothing is half-written.
        try {
          tx.abort();
        } catch {
          // Ignore: aborting an already-finished transaction throws.
        }
        if (!settled) {
          settled = true;
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        }
      });
  });
}
