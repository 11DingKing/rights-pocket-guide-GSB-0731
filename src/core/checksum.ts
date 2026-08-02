import { ChecksumMismatchError } from "./errors";

export function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** 取 Uint8Array 对应的精确 ArrayBuffer 切片（供 WebCrypto 使用）。 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** 计算字节序列的 SHA-256（十六进制小写）。 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error("当前环境不支持 WebCrypto，无法校验内容包");
  }
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return toHex(await subtle.digest("SHA-256", buffer));
}

/** 校验失败即抛 ChecksumMismatchError，由更新流程捕获并放弃切换。 */
export async function verifySha256(
  bytes: Uint8Array,
  expectedHex: string,
): Promise<void> {
  const actual = await sha256Hex(bytes);
  if (actual !== expectedHex.toLowerCase()) {
    throw new ChecksumMismatchError(expectedHex, actual);
  }
}
