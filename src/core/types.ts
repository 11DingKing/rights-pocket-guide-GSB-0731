/**
 * Domain types shared across the parsing, indexing, storage, and service layers.
 *
 * These types describe two on-disk shapes (a "full" package and a "delta"
 * package) and one derived shape (a fully resolved snapshot). Views only ever
 * consume the resolved snapshot; they never see raw packages or IndexedDB.
 */

/** A single article as authored in a full package. */
export interface RawArticle {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly legalRef: string;
}

/** A topic groups an ordered list of article ids. */
export interface RawTopic {
  readonly id: string;
  readonly title: string;
  readonly articleIds: readonly string[];
}

/** A complete, self-contained package version. */
export interface FullPackage {
  readonly kind: 'full';
  readonly packageVersion: string;
  readonly topics: readonly RawTopic[];
  readonly articles: readonly RawArticle[];
}

/** One mutation applied by a delta package. */
export type DeltaChange =
  | {
      readonly kind: 'REVISE';
      readonly articleId: string;
      readonly title: string;
      readonly body: string;
      readonly legalRef?: string;
    }
  | {
      readonly kind: 'WITHDRAW';
      readonly articleId: string;
      readonly replacementArticleId: string;
    }
  | {
      readonly kind: 'ADD';
      readonly topicId: string;
      readonly articleId: string;
      readonly title: string;
      readonly body: string;
      readonly legalRef: string;
    };

/** A package that mutates the package it succeeds. */
export interface DeltaPackage {
  readonly kind: 'delta';
  readonly packageVersion: string;
  readonly succeeds: string;
  readonly changes: readonly DeltaChange[];
}

export type ParsedPackage = FullPackage | DeltaPackage;

/** A resolved article carries the (possibly revised) authored content. */
export interface Article {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly legalRef: string;
}

/** A resolved topic references only live (non-withdrawn) article ids. */
export interface Topic {
  readonly id: string;
  readonly title: string;
  readonly articleIds: readonly string[];
}

/**
 * A fully resolved, view-ready snapshot for a single package version.
 *
 * `redirects` maps a withdrawn article id to its replacement so deep links to
 * retired articles migrate deterministically.
 */
export interface ResolvedSnapshot {
  readonly packageVersion: string;
  readonly topics: readonly Topic[];
  readonly articles: Readonly<Record<string, Article>>;
  readonly redirects: Readonly<Record<string, string>>;
  readonly withdrawn: readonly string[];
}

/** Serialized inverted index (stored next to its snapshot for offline use). */
export interface SerializedPosting {
  readonly id: string;
  readonly weight: number;
}

export interface SerializedIndexEntry {
  readonly token: string;
  readonly postings: readonly SerializedPosting[];
}

export interface SerializedIndex {
  readonly entries: readonly SerializedIndexEntry[];
}

/** A ranked search hit. */
export interface SearchHit {
  readonly articleId: string;
  readonly score: number;
}

/**
 * Reading preferences persisted independently of any content package. The
 * settings *schema* is versioned and coupled to the content package: schema 1
 * ships with the base package (2026.07.31); schema 2 (adds `underlineLinks`)
 * ships with 2026.09.01. Migration between schemas commits atomically with the
 * package switch so a forced restart can only land on {old package + schema-1
 * settings} or {new package + schema-2 settings}, never a cross-version mix.
 */
export interface ReadingSettings {
  readonly fontScale: 'normal' | 'large' | 'xlarge';
  readonly contrast: 'normal' | 'high';
  readonly lineSpacing: 'normal' | 'loose';
  /** Schema 2 addition. Present in every in-memory value; ignored by schema 1. */
  readonly underlineLinks: 'on' | 'off';
}

export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  fontScale: 'normal',
  contrast: 'normal',
  lineSpacing: 'normal',
  underlineLinks: 'on',
};

/** Latest known settings schema version. */
export const CURRENT_SETTINGS_SCHEMA = 2;

/**
 * Which settings schema a given content package version expects. Reused across
 * rounds: the round-1 base uses schema 1, the round-2 delta uses schema 2.
 */
export function settingsSchemaForPackage(packageVersion: string): number {
  return packageVersion === '2026.07.31' ? 1 : 2;
}

/** What the storage layer persists per package version. */
export interface StoredPackage {
  readonly packageVersion: string;
  readonly kind: 'full' | 'delta';
  readonly succeeds?: string;
  readonly snapshot: ResolvedSnapshot;
  readonly index: SerializedIndex;
}
