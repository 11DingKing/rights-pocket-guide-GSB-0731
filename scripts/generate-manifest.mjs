// 生成 public/materials/：复制内容包、计算真实 SHA-256 并对摘要做 ECDSA 签名，
// 供开发/构建时“下载 + 哈希校验 + 签名校验”使用。不修改 materials/ 源文件。
// 签名密钥为 scripts/dev-signing-key.json（开发 fixture）；公钥内置在应用中作为信任锚。
import { createHash, createPrivateKey, sign as nodeSign } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const materialsDir = join(root, 'materials');
const outDir = join(root, 'public', 'materials');
const keyFile = join(root, 'scripts', 'dev-signing-key.json');

const keyPair = JSON.parse(await readFile(keyFile, 'utf8'));
const privateKey = createPrivateKey({ key: keyPair.privateJwk, format: 'jwk' });

function signHex(sha256Hex) {
  // 与 WebCrypto 对齐：ECDSA + SHA-256，IEEE-P1363 签名格式，标准 base64 输出。
  return nodeSign('sha256', Buffer.from(sha256Hex, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363'
  }).toString('base64');
}

await mkdir(outDir, { recursive: true });

const files = (await readdir(materialsDir)).filter((f) => f.endsWith('.json')).sort();
const packages = [];
for (const file of files) {
  const bytes = await readFile(join(materialsDir, file));
  const parsed = JSON.parse(bytes.toString('utf8'));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await copyFile(join(materialsDir, file), join(outDir, file));
  packages.push({
    packageVersion: parsed.packageVersion,
    url: `materials/${file}`,
    sha256,
    signature: signHex(sha256),
    kind: Array.isArray(parsed.changes) ? 'delta' : 'full',
    ...(typeof parsed.succeeds === 'string' ? { succeeds: parsed.succeeds } : {})
  });
}

const latest = packages.length > 0 ? packages[packages.length - 1].packageVersion : null;
const manifest = { generatedAt: new Date().toISOString(), latest, packages };
await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest: ${packages.length} 个内容包（已签名），最新版本 ${latest}`);
