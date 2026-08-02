// 传输（wire）类型：内容包 JSON 的形状。
export interface TopicWire {
  id: string;
  title: string;
  articleIds: string[];
}

export interface ArticleWire {
  id: string;
  title: string;
  body: string;
  legalRef: string;
}

export interface FullPackageWire {
  packageVersion: string;
  topics: TopicWire[];
  articles: ArticleWire[];
}

export type ChangeWire =
  | { kind: "REVISE"; articleId: string; title: string; body: string }
  | { kind: "WITHDRAW"; articleId: string; replacementArticleId: string }
  | {
      kind: "ADD";
      topicId: string;
      articleId: string;
      title: string;
      body: string;
      legalRef: string;
    };

export interface DeltaPackageWire {
  packageVersion: string;
  succeeds: string;
  changes: ChangeWire[];
  checksum?: string;
}

// 物化（运行时）类型：解析 + 增量应用后的完整、自洽内容。
export interface Topic {
  id: string;
  title: string;
  articleIds: string[];
}

export interface Article {
  id: string;
  title: string;
  body: string;
  legalRef: string;
}

export interface ContentPackage {
  packageVersion: string;
  /** 全量包为 null；增量包为其 succeeds 版本。 */
  baseVersion: string | null;
  topics: Topic[];
  /** 仅包含当前有效的（未撤下）条目。 */
  articles: Readonly<Record<string, Article>>;
  /** 被撤下条目 id -> 最终替代的有效条目 id（链式已归一化）。 */
  withdrawals: Readonly<Record<string, string>>;
}

// 更新清单（由 scripts/generate-manifest.mjs 生成：sha256 为下载校验权威值，
// signature 为对 sha256 的 ECDSA 签名，由随应用分发的公钥验证）。
export interface ManifestEntry {
  packageVersion: string;
  url: string;
  sha256: string;
  signature: string;
  kind: "full" | "delta";
  succeeds?: string;
}

export interface UpdateManifest {
  latest: string;
  packages: ManifestEntry[];
}

// 阅读设置的字段枚举（schema 见 core/settingsSchema.ts）。
export type FontScale = "standard" | "large" | "xlarge";
export type ThemeName = "system" | "light" | "dark" | "contrast";
export type LineSpacing = "standard" | "loose";
export type LetterSpacing = "standard" | "wide";
