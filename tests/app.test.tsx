import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServiceContext } from '../src/hooks/useService';
import { App } from '../src/App';
import { ContentService } from '../src/services/contentService';
import type { ContentRepository } from '../src/storage/repository';
import {
  createRepository,
  deleteDatabase,
  expectedV2Checksum,
  loadV2Bytes,
  seedPack,
} from './helpers';

let repository: ContentRepository;
let service: ContentService;
let user: ReturnType<typeof userEvent.setup>;

async function renderApp(): Promise<void> {
  await act(async () => {
    render(
      <ServiceContext.Provider value={service}>
        <App />
      </ServiceContext.Provider>,
    );
  });
}

async function mockFetchForUpdate(): Promise<void> {
  const bytes = loadV2Bytes();
  const checksum = await expectedV2Checksum();
  global.fetch = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/update-manifest.json')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ url: '/content-pack-v2.json', checksum }),
      } as unknown as Response);
    }
    if (url.endsWith('/content-pack-v2.json')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
      } as unknown as Response);
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  }) as unknown as typeof fetch;
}

beforeEach(async () => {
  window.location.hash = '';
  repository = await createRepository();
  service = new ContentService(repository);
  await act(async () => {
    await service.initialize(seedPack());
  });
  user = userEvent.setup();
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  repository.close();
  await deleteDatabase();
});

describe('first offline launch', () => {
  it('renders bundled v1 content without any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await renderApp();

    expect(screen.getByRole('heading', { name: '法律援助' })).toBeInTheDocument();
    expect(screen.getByText('无固定生活来源免予经济困难核查')).toBeInTheDocument();
    expect(screen.getByText(/当前版本 2026.07.31/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('icon buttons and non-color status', () => {
  it('exposes accessible names for all icon buttons', async () => {
    await renderApp();
    expect(screen.getByRole('button', { name: '打开搜索' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '阅读设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检查更新' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回首页' })).toBeInTheDocument();
  });

  it('communicates update status with text, not color alone', async () => {
    await mockFetchForUpdate();
    await renderApp();
    await user.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() => {
      expect(screen.getByText(/已更新到版本 2026.09.01/)).toBeInTheDocument();
    });
    const status = screen.getByTestId('update-status');
    expect(status.getAttribute('data-tone')).toBe('status-success');
    expect(status.textContent).toContain('已更新到版本');
  });
});

describe('keyboard path and focus restoration', () => {
  it('navigates topics and articles entirely by keyboard and restores focus on back', async () => {
    await renderApp();

    (document.activeElement as HTMLElement | null)?.blur();

    await user.tab();
    expect(document.activeElement).toHaveTextContent('跳到主要内容');

    await user.tab();
    expect(document.activeElement).toHaveAttribute('aria-label', '返回首页');

    await user.tab();
    expect(document.activeElement).toHaveAttribute('aria-label', '打开搜索');
    await user.tab();
    expect(document.activeElement).toHaveAttribute('aria-label', '阅读设置');
    await user.tab();
    expect(document.activeElement).toHaveAttribute('aria-label', '检查更新');

    await user.tab();
    const firstTopic = document.activeElement as HTMLElement;
    expect(firstTopic).toHaveTextContent('法律援助');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(window.location.hash).toBe('#/topic/TOPIC-AID');
    });
    const topicHeading = screen.getByRole('heading', { name: '法律援助' });
    expect(document.activeElement).toBe(topicHeading);

    const firstArticle = await screen.findByRole('link', {
      name: /无固定生活来源免予经济困难核查/,
    });
    act(() => firstArticle.focus());
    expect(document.activeElement).toBe(firstArticle);
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(window.location.hash).toBe('#/article/ART-AID-1');
    });
    expect(
      screen.getByRole('heading', { name: '无固定生活来源免予经济困难核查' }),
    ).toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: '无固定生活来源免予经济困难核查' }),
    );

    act(() => {
      window.history.back();
    });
    await waitFor(() => {
      expect(window.location.hash).toBe('#/topic/TOPIC-AID');
    });
    expect((document.activeElement as HTMLElement).getAttribute('href')).toBe(
      '#/article/ART-AID-1',
    );
  });
});

describe('screen reader announcements', () => {
  it('announces route changes through the polite live region', async () => {
    await renderApp();
    const liveRegion = screen.getByTestId('live-region');

    const topicLink = screen.getAllByRole('link', { name: /法律援助/ })[0] as HTMLElement;
    await user.click(topicLink);
    await waitFor(() => {
      expect(liveRegion.textContent).toContain('法律援助');
    });

    const articleLink = await screen.findByRole('link', {
      name: /无固定生活来源免予经济困难核查/,
    });
    await user.click(articleLink);
    await waitFor(() => {
      expect(liveRegion.textContent).toContain('无固定生活来源免予经济困难核查');
    });
  });

  it('announces update progress and success via a status region', async () => {
    await mockFetchForUpdate();
    await renderApp();
    await user.click(screen.getByRole('button', { name: '检查更新' }));

    const status = screen.getByTestId('update-status');
    await waitFor(() => {
      expect(status.textContent).toContain('已更新到版本 2026.09.01');
    });
  });

  it('announces failure and keeps old content when offline', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    await renderApp();
    await user.click(screen.getByRole('button', { name: '检查更新' }));
    const status = screen.getByTestId('update-status');
    await waitFor(() => {
      expect(status.textContent).toContain('更新失败');
    });
    expect(screen.getByText('无固定生活来源免予经济困难核查')).toBeInTheDocument();
  });
});

describe('deep links and withdrawal migration', () => {
  it('loads a topic and article directly from the hash', async () => {
    window.location.hash = '#/article/ART-NOTARY-1';
    await renderApp();
    expect(
      screen.getByRole('heading', { name: '公证费用减免' }),
    ).toBeInTheDocument();
    expect(screen.getByText('公证服务规范')).toBeInTheDocument();
  });

  it('loads search results from a deep link', async () => {
    window.location.hash = '#/search?q=公证';
    await renderApp();
    expect(
      screen.getByRole('heading', { name: /“公证”的搜索结果：2 条/ }),
    ).toBeInTheDocument();
    const resultLinks = screen.getAllByRole('link', { name: /公证|公共法律服务/ });
    expect(resultLinks[0]?.textContent).toContain('公证费用减免');
  });

  it('redirects a withdrawn article deep link to its replacement after update', async () => {
    await mockFetchForUpdate();
    window.location.hash = '#/article/ART-AID-2';
    await renderApp();

    expect(
      screen.getByRole('heading', { name: '行动不便时的服务方式' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() => {
      expect(window.location.hash).toBe('#/article/ART-SERVICE-3');
    });
    expect(
      screen.getByRole('heading', { name: '行动不便时的上门服务' }),
    ).toBeInTheDocument();
    const liveRegion = screen.getByTestId('notice-region');
    await waitFor(() => {
      expect(liveRegion.textContent).toContain('内容已更新');
      expect(liveRegion.textContent).toContain('已为您跳转到替代文章');
      expect(liveRegion.textContent).toContain('行动不便时的上门服务');
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: '行动不便时的上门服务' }),
      );
    });
  });
});

describe('reading settings', () => {
  it('applies and persists font size and theme', async () => {
    await renderApp();
    await user.click(screen.getByRole('button', { name: '阅读设置' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '阅读设置' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('radio', { name: '较大' }));
    await user.click(screen.getByRole('radio', { name: '深色' }));
    await user.click(screen.getByRole('radio', { name: '宽松' }));

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-font-size')).toBe('large');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(document.documentElement.getAttribute('data-line-spacing')).toBe('spacious');
    });

    const saved = await repository.loadSettings();
    expect(saved).toEqual({ fontSize: 'large', theme: 'dark', lineSpacing: 'spacious' });
  });
});

describe('update and rollback via UI', () => {
  it('updates to v2, shows new content, and can rollback to v1', async () => {
    await mockFetchForUpdate();
    await renderApp();
    await user.click(screen.getByRole('button', { name: '检查更新' }));

    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: /行动不便时的上门服务/ }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText('行动不便时的服务方式')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '回滚到上一版本' }));
    await waitFor(() => {
      expect(screen.getByText('行动不便时的服务方式')).toBeInTheDocument();
    });
    expect(screen.queryByText('行动不便时的上门服务')).not.toBeInTheDocument();
  });
});
