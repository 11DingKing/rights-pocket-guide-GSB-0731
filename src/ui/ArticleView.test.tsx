import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { AnnouncerProvider } from '../app/Announcer';
import { ContentRepository } from '../services/repository';
import type { StoredPackage } from '../core/types';
import { PackageStore } from '../storage/packageStore';
import { ArticleView } from './ArticleView';

/**
 * Deep-link migration UX and the accessible degraded state for a cyclic
 * replacement chain. We build minimal StoredPackages directly so we can force a
 * cycle (install-time resolution rejects cyclic packs, so this is the defensive
 * runtime path). Focus retention on the view heading is asserted alongside the
 * screen-reader announcement.
 */
function freshIndexedDb(): void {
  globalThis.indexedDB = new IDBFactory();
}

function pkg(overrides: Partial<StoredPackage['snapshot']>): StoredPackage {
  return {
    packageVersion: '2026.09.01',
    kind: 'delta',
    succeeds: '2026.07.31',
    snapshot: {
      packageVersion: '2026.09.01',
      topics: [{ id: 'T', title: '主题', articleIds: ['ART-NEW'] }],
      articles: {
        'ART-NEW': {
          id: 'ART-NEW',
          title: '替代文章',
          body: '正文',
          legalRef: '依据',
        },
      },
      redirects: { 'ART-OLD': 'ART-NEW' },
      withdrawn: ['ART-OLD'],
      ...overrides,
    },
    index: { entries: [] },
  };
}

async function makeRepo(p: StoredPackage): Promise<ContentRepository> {
  const store = await PackageStore.open();
  return new ContentRepository(p, store);
}

function renderArticle(repo: ContentRepository, articleId: string): void {
  render(
    <AnnouncerProvider>
      <ArticleView
        repository={repo}
        articleId={articleId}
        navigate={() => undefined}
      />
    </AnnouncerProvider>,
  );
}

beforeEach(() => {
  freshIndexedDb();
});
afterEach(() => {
  freshIndexedDb();
});

describe('withdrawn deep-link migration UX', () => {
  it('retains focus on the heading, shows replacement, and announces 内容已更新', async () => {
    const repo = await makeRepo(pkg({}));
    renderArticle(repo, 'ART-OLD');

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: '替代文章',
    });
    // Focus is retained on the destination view heading.
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    // Visible migration notice (icon + text, not colour-only).
    expect(screen.getByText(/原条目（ART-OLD）已撤下/)).toBeInTheDocument();
    // Announced to screen readers.
    await waitFor(() => {
      expect(screen.getByTestId('live-region')).toHaveTextContent(
        /内容已更新，已跳转到替代条目/,
      );
    });
  });

  it('renders a stable accessible degraded state for a cyclic replacement chain', async () => {
    // ART-OLD → ART-LOOP → ART-OLD (cycle); neither is a live article.
    const cyclic = pkg({
      articles: {},
      redirects: { 'ART-OLD': 'ART-LOOP', 'ART-LOOP': 'ART-OLD' },
      withdrawn: ['ART-OLD', 'ART-LOOP'],
      topics: [],
    });
    const repo = await makeRepo(cyclic);
    renderArticle(repo, 'ART-OLD');

    // Degraded state is an alert with a heading, not a blank/crash.
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: '内容暂时无法打开',
    });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Reassures that reading settings are unaffected.
    expect(screen.getByText(/阅读设置未受影响/)).toBeInTheDocument();
    const live = screen.getByTestId('live-region');
    await waitFor(() => {
      expect(live).toHaveTextContent(/循环.*安全降级/);
    });
  });
});
