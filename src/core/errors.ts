// 统一错误类型：解析、校验、更新路径、存储配额。
export type UpdateStage =
  | "download"
  | "checksum"
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
