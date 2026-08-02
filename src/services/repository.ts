/**
 * Repository — the ONLY interface the React views use to reach content. It
 * exposes an immutable, resolved view of the active package plus deterministic
 * search, deep-link migration, and reading settings. Views never import the
 * storage or service layers, and never touch IndexedDB.
 */
import { followRedirect } from '../core/resolve';
import { SearchIndex } from '../core/search/index';
import type {
  Article,
  ReadingSettings,
  ResolvedSnapshot,
  SearchHit,
  StoredPackage,
  Topic,
} from '../core/types';
import type { PackageStore } from '../storage/packageStore';

export interface DeepLinkTarget {
  readonly articleId: string;
  readonly migrated: boolean;
  readonly requestedId: string;
}

/** A frozen, view-ready snapshot of the active content package. */
export class ContentRepository {
  private readonly index: SearchIndex;

  constructor(
    private readonly stored: StoredPackage,
    private readonly store: PackageStore,
  ) {
    this.index = new SearchIndex(stored.index);
  }

  get packageVersion(): string {
    return this.stored.packageVersion;
  }

  get snapshot(): ResolvedSnapshot {
    return this.stored.snapshot;
  }

  get topics(): readonly Topic[] {
    return this.stored.snapshot.topics;
  }

  getArticle(id: string): Article | undefined {
    return this.stored.snapshot.articles[id];
  }

  /** Deterministic full-text search over the active package. */
  search(query: string): SearchHit[] {
    return this.index.search(query);
  }

  /**
   * Resolve a requested article id (possibly a withdrawn one) to a live target,
   * reporting whether a migration happened. Returns undefined for unknown ids.
   */
  resolveDeepLink(requestedId: string): DeepLinkTarget | undefined {
    const result = followRedirect(this.stored.snapshot, requestedId);
    if (result === undefined) {
      return undefined;
    }
    return {
      articleId: result.targetId,
      migrated: result.migrated,
      requestedId,
    };
  }

  getSettings(): Promise<ReadingSettings> {
    return this.store.getSettings();
  }

  saveSettings(settings: ReadingSettings): Promise<void> {
    return this.store.saveSettings(settings);
  }
}
