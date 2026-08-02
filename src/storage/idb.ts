import { StorageQuotaError } from "../core/errors";

/** 把 IndexedDB 的 DOMException 映射为应用内错误类型。 */
export function mapIdbError(error: unknown): Error {
  if (error instanceof DOMException) {
    if (error.name === "QuotaExceededError") {
      return new StorageQuotaError();
    }
    return new Error(`IndexedDB 错误（${error.name}）：${error.message}`);
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error("未知 IndexedDB 错误");
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(mapIdbError(request.error));
  });
}

export function openDatabase(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(mapIdbError(request.error));
    request.onblocked = () => reject(new Error("IndexedDB 被其他标签页占用"));
  });
}

/**
 * 在单个事务内执行操作队列。fn 内只允许 await 由 requestToPromise
 * 包装的本事务请求（microtask 链保持事务存活），事务提交才视为成功。
 * 提交前任何异常/崩溃都会使事务回滚 —— 这是“原子切换”的底层保证。
 */
export function runInTransaction<T>(
  db: IDBDatabase,
  storeNames: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let fnResult: Promise<T> | null = null;
    // fn 主动抛出的错误优先于 abort/error 事件（避免被 AbortError 掩盖）。
    let fnError: unknown = null;

    tx.oncomplete = () => {
      if (fnResult !== null) {
        fnResult.then(resolve, reject);
      } else {
        reject(new Error('事务完成但未产生结果'));
      }
    };
    tx.onerror = () =>
      reject(fnError !== null ? mapIdbError(fnError) : mapIdbError(tx.error));
    tx.onabort = () =>
      reject(
        fnError !== null
          ? mapIdbError(fnError)
          : mapIdbError(tx.error ?? new DOMException('事务中止', 'AbortError'))
      );

    try {
      fnResult = fn(tx);
      fnResult.catch((error: unknown) => {
        // fn 失败时主动中止，确保不会提交半套写入。
        fnError = error;
        try {
          tx.abort();
        } catch {
          // 事务可能已结束，忽略。
        }
      });
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // 忽略重复中止。
      }
      reject(mapIdbError(error));
    }
  });
}
