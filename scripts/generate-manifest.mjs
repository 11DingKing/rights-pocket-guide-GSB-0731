// 生成 public/materials/：复制内容包并计算真实 SHA-256，供开发/构建时“下载+校验”使用。
// 不修改 materials/ 源文件；manifest 的 sha256 是下载校验的唯一权威依据。
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const materialsDir = join(root, "materials");
const outDir = join(root, "public", "materials");

await mkdir(outDir, { recursive: true });

const files = (await readdir(materialsDir))
  .filter((f) => f.endsWith(".json"))
  .sort();
const packages = [];
for (const file of files) {
  const bytes = await readFile(join(materialsDir, file));
  const parsed = JSON.parse(bytes.toString("utf8"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await copyFile(join(materialsDir, file), join(outDir, file));
  packages.push({
    packageVersion: parsed.packageVersion,
    url: `materials/${file}`,
    sha256,
    kind: Array.isArray(parsed.changes) ? "delta" : "full",
    ...(typeof parsed.succeeds === "string"
      ? { succeeds: parsed.succeeds }
      : {}),
  });
}

const latest =
  packages.length > 0 ? packages[packages.length - 1].packageVersion : null;
const manifest = { generatedAt: new Date().toISOString(), latest, packages };
await writeFile(
  join(outDir, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`manifest: ${packages.length} 个内容包，最新版本 ${latest}`);
