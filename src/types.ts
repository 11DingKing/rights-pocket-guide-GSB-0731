export interface Article {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly legalRef: string;
}

export interface Topic {
  readonly id: string;
  readonly title: string;
  readonly articleIds: ReadonlyArray<string>;
}

export interface Withdrawal {
  readonly replacementArticleId: string | null;
}

export interface MaterializedPack {
  readonly packageVersion: string;
  readonly succeeds: string | null;
  readonly topics: ReadonlyArray<Topic>;
  readonly articles: Readonly<Record<string, Article>>;
  readonly withdrawals: Readonly<Record<string, Withdrawal>>;
}

export type ChangeKind = 'REVISE' | 'WITHDRAW' | 'ADD';

export interface ReviseChange {
  readonly kind: 'REVISE';
  readonly articleId: string;
  readonly title?: string;
  readonly body?: string;
  readonly legalRef?: string;
}

export interface WithdrawChange {
  readonly kind: 'WITHDRAW';
  readonly articleId: string;
  readonly replacementArticleId: string;
}

export interface AddChange {
  readonly kind: 'ADD';
  readonly topicId: string;
  readonly articleId: string;
  readonly title: string;
  readonly body: string;
  readonly legalRef: string;
}

export type ContentChange = ReviseChange | WithdrawChange | AddChange;

export interface FullPack {
  readonly packageVersion: string;
  readonly succeeds?: string;
  readonly topics: ReadonlyArray<Topic>;
  readonly articles: ReadonlyArray<Article>;
}

export interface DeltaPack {
  readonly packageVersion: string;
  readonly succeeds: string;
  readonly changes: ReadonlyArray<ContentChange>;
  readonly checksum?: string;
  readonly failureCases?: ReadonlyArray<string>;
}

export type RawPack = FullPack | DeltaPack;

export type FontSize = 'small' | 'medium' | 'large' | 'xlarge';
export type Theme = 'light' | 'dark' | 'high-contrast';
export type LineSpacing = 'compact' | 'normal' | 'spacious';

export interface ReadingSettings {
  readonly fontSize: FontSize;
  readonly theme: Theme;
  readonly lineSpacing: LineSpacing;
}

export const SETTINGS_SCHEMA_VERSION_V1 = 1;
export const SETTINGS_SCHEMA_VERSION_V2 = 2;
export const CURRENT_SETTINGS_SCHEMA = SETTINGS_SCHEMA_VERSION_V2;

export const DEFAULT_SETTINGS: ReadingSettings = {
  fontSize: 'medium',
  theme: 'light',
  lineSpacing: 'normal',
};

export interface PersistedSettings {
  readonly schemaVersion: number;
  readonly settings: ReadingSettings;
}

export type UpdatePhase =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'resolving'
  | 'staging'
  | 'indexing'
  | 'committing'
  | 'success'
  | 'failed';

export interface UpdateStatus {
  readonly phase: UpdatePhase;
  readonly message: string;
  readonly newVersion: string | null;
}

export interface SearchHit {
  readonly articleId: string;
  readonly score: number;
  readonly matchedFields: ReadonlyArray<'title' | 'body' | 'legalRef'>;
}

export type Downloader = (url: string, signal: AbortSignal) => Promise<Uint8Array>;
