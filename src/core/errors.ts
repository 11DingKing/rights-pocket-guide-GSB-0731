// 统一错误类型：解析、校验、更新路径、存储配额。
export type UpdateStage =
  | "download"
  | "checksum"
  | "signature"
  | "parse"
  | "materialize"
  | "index"
  | "staging"
  | "switch";

export class PackParseError extends Error {
  readonly details: readonly string[];

  constructor(details: readonly string[]) {
    super(`内容包格式无效：${details.join("；")}`);
    this.name = "PackParseError";
    this.details = details;
  }
}

export class ChecksumMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`校验和不匹配（期望 ${expected}，实际 ${actual}）`);
    this.name = "ChecksumMismatchError";
  }
}

export class UpdatePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpdatePathError";
  }
}

export class StorageQuotaError extends Error {
  constructor(message = "IndexedDB 存储空间不足") {
    super(message);
    this.name = "StorageQuotaError";
  }
}

export class InvalidSignatureError extends Error {
  constructor(message = "内容包签名无效") {
    super(message);
    this.name = "InvalidSignatureError";
  }
}

/** 切换事务提交时发现基线版本已变化（另一个标签页/流程抢先提交）。 */
export class SwitchConflictError extends Error {
  constructor(expectedBase: string, actualActive: string | null) {
    super(
      `版本冲突：本次更新基于 ${expectedBase}，但当前激活版本已是 ${actualActive ?? "无"}，放弃提交`
    );
    this.name = "SwitchConflictError";
  }
}
