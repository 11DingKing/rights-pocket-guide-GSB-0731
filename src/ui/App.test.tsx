import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { StrictMode } from 'react';
import { AnnouncerProvider } from '../app/Announcer';
import { bootstrap, type BootstrapResult } from '../services/bootstrap';
import { BundledFetcher } from '../services/fetcher';
import { PackageStore } from '../storage/packageStore';
import { App } from './App';
import {
  baseOnlyManifestText,
  manifestText,
  packTexts,
  v2Text,
} from '../test/fixtures';

async function boot(): Promise<BootstrapResult> {
  const store = await PackageStore.open();
  return bootstrap({
    store,
    fetcher: new BundledFetcher(manifestText, packTexts),
    manifestUrl: 'materials/manifest.json',
  });
}

function renderApp(result: BootstrapResult): void {
  render(
    <StrictMode>
      <AnnouncerProvider>
        <App
          repository={result.repository}
          activeVersion={result.activeVersion}
          latestAttempted={result.latestAttempted}
          usedBundledSeed={result.usedBundledSeed}
          {...(result.updateError === undefined
            ? {}
            : { updateError: result.updateError })}
        />
      </AnnouncerProvider>
    </StrictMode>,
  );
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  window.location.hash = '#/';
});
afterEach(() => {
  globalThis.indexedDB = new IDBFactory();
  window.location.hash = '';
});

describe('accessible reading flow', () => {
  it('first launch shows topics from the resolved latest package', async () => {
    const result = await boot();
    expect(result.activeVersion).toBe('2026.09.01');
    renderApp(result);

    expect(
      await screen.findByRole('heading', { level: 1, name: '权益主题' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /法律援助/ })).toBeInTheDocument();
  });

  it('completes a full keyboard path: home → topic → article with focus moves', async () => {
    const user = userEvent.setup();
    renderApp(await boot());
    const homeHeading = await screen.findByRole('heading', {
      level: 1,
      name: '权益主题',
    });
    // On load, focus lands on the view heading (focus restoration).
    await waitFor(() => {
      expect(homeHeading).toHaveFocus();
    });

    // Tab forward from the heading to the first topic link and activate it.
    await user.tab();
    const topicLink = screen.getByRole('link', { name: /法律援助/ });
    expect(topicLink).toHaveFocus();
    await user.keyboard('{Enter}');

    // Topic view heading receives focus.
    const topicHeading = await screen.findByRole('heading', {
      level: 1,
      name: '法律援助',
    });
    await waitFor(() => {
      expect(topicHeading).toHaveFocus();
    });

    // Tab to the first article link and open it with the keyboard.
    await user.tab();
    const articleLink = screen.getByRole('link', {
      name: '无固定生活来源的法援核查规则',
    });
    expect(articleLink).toHaveFocus();
    await user.keyboard('{Enter}');

    // Article view heading receives focus (focus restoration on deep view).
    const articleHeading = await screen.findByRole('heading', {
      level: 1,
      name: '无固定生活来源的法援核查规则',
    });
    await waitFor(() => {
      expect(articleHeading).toHaveFocus();
    });
  });

  it('restores focus to the view heading on each route change', async () => {
    const user = userEvent.setup();
    renderApp(await boot());
    await screen.findByRole('heading', { level: 1, name: '权益主题' });

    await user.click(screen.getByRole('link', { name: '阅读设置' }));
    const settingsHeading = await screen.findByRole('heading', {
      level: 1,
      name: '阅读设置',
    });
    await waitFor(() => {
      expect(settingsHeading).toHaveFocus();
    });
  });

  it('announces the search result count via the live region', async () => {
    const user = userEvent.setup();
    renderApp(await boot());
    await screen.findByRole('heading', { level: 1, name: '权益主题' });

    await user.click(screen.getByRole('link', { name: '检索' }));
    const input = await screen.findByLabelText('检索关键词');
    await user.click(input);
    await user.keyboard('援助{Enter}');

    const live = screen.getByTestId('live-region');
    await waitFor(() => {
      expect(live).toHaveTextContent(/找到 \d+ 条结果/);
    });
  });
});

describe('deep-link migration for withdrawn articles', () => {
  it('migrates a withdrawn article deep link and announces it', async () => {
    const result = await boot();
    window.location.hash = '#/article/ART-AID-2';
    renderApp(result);

    // The replacement article's content is shown.
    expect(
      await screen.findByRole('heading', { level: 1, name: '行动不便时的上门服务' }),
    ).toBeInTheDocument();

    // A visible, non-colour-only migration notice is present.
    expect(screen.getByText(/已.*跳转到替代条目/)).toBeInTheDocument();

    // And it is announced to screen readers.
    const live = screen.getByTestId('live-region');
    await waitFor(() => {
      expect(live).toHaveTextContent(/已跳转到替代条目/);
    });
  });
});

describe('reading settings persistence', () => {
  it('persists a font-scale change across a simulated restart', async () => {
    const user = userEvent.setup();
    const first = await boot();
    renderApp(first);
    await user.click(await screen.findByRole('link', { name: '阅读设置' }));

    const large = await screen.findByRole('radio', { name: '大' });
    await user.click(large);
    await waitFor(() => {
      expect(document.documentElement.dataset['fontScale']).toBe('large');
    });

    // Simulated restart: re-bootstrap against the same IndexedDB.
    const second = await boot();
    const settings = await second.repository.getSettings();
    expect(settings.fontScale).toBe('large');
  });
});

describe('offline update failure surfaces the old version', () => {
  it('keeps the complete old package and shows a non-colour-only warning', async () => {
    // Session 1: seed v1 only (manifest advertises only the full base).
    const store1 = await PackageStore.open();
    await bootstrap({
      store: store1,
      fetcher: new BundledFetcher(baseOnlyManifestText, packTexts),
      manifestUrl: 'materials/manifest.json',
    });
    store1.close();

    // Session 2: manifest now advertises v2 but the v2 pack is corrupt.
    const store2 = await PackageStore.open();
    const corrupt = new BundledFetcher(manifestText, {
      ...packTexts,
      'content-pack-v2.json': `${v2Text} `,
    });
    const result = await bootstrap({
      store: store2,
      fetcher: corrupt,
      manifestUrl: 'materials/manifest.json',
    });
    expect(result.activeVersion).toBe('2026.07.31');
    expect(result.updateError?.stage).toBe('verify');

    renderApp(result);
    await screen.findByRole('heading', { level: 1, name: '权益主题' });
    // Status conveys state with an icon glyph + text, not colour alone.
    expect(screen.getByText(/更新未生效/)).toBeInTheDocument();
    expect(screen.getByText('!')).toBeInTheDocument();
  });
});
