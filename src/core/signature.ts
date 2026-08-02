import { InvalidSignatureError } from './errors';
import { textToBytes, toArrayBuffer } from './checksum';

export function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64Decode(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * 校验内容包签名：签名对象是 SHA-256 摘要的十六进制字符串（UTF-8 字节），
 * 算法 ECDSA P-256 + SHA-256（IEEE-P1363 签名格式）。
 * 字节 → 摘要 → 签名构成完整信任链；任何一环被篡改都会抛 InvalidSignatureError。
 */
export async function verifyPackSignature(
  sha256Hex: string,
  signatureBase64: string,
  publicKeyJwk: JsonWebKey
): Promise<void> {
  try {
    const key = await globalThis.crypto.subtle.importKey(
      'jwk',
      publicKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const valid = await globalThis.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      toArrayBuffer(base64Decode(signatureBase64)),
      toArrayBuffer(textToBytes(sha256Hex))
    );
    if (!valid) {
      throw new InvalidSignatureError('签名与内容摘要不匹配');
    }
  } catch (error) {
    if (error instanceof InvalidSignatureError) {
      throw error;
    }
    throw new InvalidSignatureError(
      `签名校验失败：${error instanceof Error ? error.message : String(error)}`
    );
  }
}
