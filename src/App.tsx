import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useServiceState } from './hooks/useServiceState';
import { useService } from './hooks/useService';
import { useRouter } from './router/useRouter';
import { replaceHash } from './router/routes';
import type { Route } from './router/routes';
import { useFocusRestoration } from './a11y/focusManager';
import { Header } from './components/Header';
import { TopicList } from './components/TopicList';
import { ArticleList } from './components/ArticleList';
import { ArticleView } from './components/ArticleView';
import { SearchResults } from './components/SearchResults';
import { SettingsView } from './components/SettingsView';
import { SkipLink } from './components/SkipLink';
import { LiveRegion } from './components/LiveRegion';
import { ContentService } from './services/contentService';
import type { ReadingSettings } from './types';

interface Manifest {
  readonly url: string;
  readonly checksum: string;
}

async function fetchManifest(): Promise<Manifest> {
  const response = await fetch('/update-manifest.json');
  if (!response.ok) {
    throw new Error(`无法获取更新清单：HTTP ${response.status}`);
  }
  return (await response.json()) as Manifest;
}

function routeAnnouncement(
  route: Route,
  pack: NonNullable<ReturnType<typeof useServiceState>['pack']>,
): string {
  switch (route.name) {
    case 'home':
      return '首页';
    case 'topic': {
      const topic = pack.topics.find((t) => t.id === route.topicId);
      return topic === undefined ? '主题不存在' : topic.title;
    }
    case 'article': {
      const article = pack.articles[route.articleId];
      return article === undefined ? '文章不存在' : article.title;
    }
    case 'search':
      return route.query.trim().length === 0
        ? '搜索'
        : `正在搜索 ${route.query}`;
    case 'settings':
      return '阅读设置';
    case 'notFound':
      return '页面不存在';
  }
}

export function App() {
  const state = useServiceState();
  const service = useService();
  const route = useRouter();
  const mainRef = useRef<HTMLElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const [notice, setNotice] = useState('');
  const redirectingRef = useRef(false);

  useFocusRestoration(route, mainRef);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-font-size', state.settings.fontSize);
    root.setAttribute('data-theme', state.settings.theme);
  }, [state.settings]);

  const withdrawalEffect = useCallback(() => {
    if (route.name !== 'article' || state.pack === null) return;
    const withdrawal = state.pack.withdrawals[route.articleId];
    if (withdrawal === undefined) return;
    if (withdrawal.replacementArticleId !== null) {
      const replacement = state.pack.articles[withdrawal.replacementArticleId];
      const title = replacement?.title ?? withdrawal.replacementArticleId;
      redirectingRef.current = true;
      setNotice(`该文章已撤下，已为您跳转到替代文章：${title}`);
      replaceHash({ name: 'article', articleId: withdrawal.replacementArticleId });
    } else {
      setNotice('该文章已撤下，且没有替代文章。');
    }
  }, [route, state.pack]);

  useEffect(() => {
    withdrawalEffect();
  }, [withdrawalEffect]);

  useEffect(() => {
    if (state.pack === null) return;
    if (route.name === 'article' && state.pack.withdrawals[route.articleId]) {
      return;
    }
    if (redirectingRef.current) {
      redirectingRef.current = false;
      setAnnouncement(routeAnnouncement(route, state.pack));
      return;
    }
    setNotice('');
    setAnnouncement(routeAnnouncement(route, state.pack));
  }, [route, state.pack]);

  const searchHits = useMemo(() => {
    if (route.name !== 'search' || state.index === null) return [];
    return state.index.search(route.query, 20);
  }, [route, state.index]);

  const handleCheckUpdate = useCallback(async () => {
    try {
      service.resetUpdateStatus();
      const manifest = await fetchManifest();
      await service.checkUpdate(manifest.url, {
        expectedChecksum: manifest.checksum,
        downloader: ContentService.createDefaultDownloader(),
      });
    } catch (error) {
      if (service.getState().updateStatus.phase !== 'failed') {
        const message =
          error instanceof Error ? error.message : '无法获取更新清单';
        service.reportUpdateFailure(`更新失败，仍在使用旧版本：${message}`);
      }
    }
  }, [service]);

  const handleSettingsChange = useCallback(
    (settings: ReadingSettings) => {
      void service.updateSettings(settings);
    },
    [service],
  );

  const handleRollback = useCallback(async () => {
    try {
      await service.rollback();
    } catch {
      // 错误状态由服务公告。
    }
  }, [service]);

  if (!state.ready || state.pack === null) {
    return (
      <div className="loading" role="status">
        正在加载离线内容…
      </div>
    );
  }

  const pack = state.pack;

  let content: React.JSX.Element;
  if (route.name === 'home') {
    const firstTopic = pack.topics[0];
    content =
      firstTopic !== undefined ? (
        <ArticleList pack={pack} topic={firstTopic} currentRoute={route} />
      ) : (
        <p>暂无内容。</p>
      );
  } else if (route.name === 'topic') {
    const topic = pack.topics.find((t) => t.id === route.topicId);
    content =
      topic !== undefined ? (
        <ArticleList pack={pack} topic={topic} currentRoute={route} />
      ) : (
        <p>主题不存在。</p>
      );
  } else if (route.name === 'article') {
    if (pack.withdrawals[route.articleId] !== undefined) {
      content = <p>正在跳转到替代文章…</p>;
    } else {
      const article = pack.articles[route.articleId];
      content =
        article !== undefined ? (
          <ArticleView article={article} />
        ) : (
          <p>文章不存在。</p>
        );
    }
  } else if (route.name === 'search') {
    content = (
      <SearchResults
        pack={pack}
        query={route.query}
        hits={searchHits}
        currentRoute={route}
      />
    );
  } else if (route.name === 'settings') {
    content = (
      <SettingsView settings={state.settings} onChange={handleSettingsChange} />
    );
  } else {
    content = <p>页面不存在。</p>;
  }

  const canRollback = state.canRollback;

  return (
    <div className="app-shell">
      <SkipLink />
      <LiveRegion message={announcement} />
      <LiveRegion message={notice} politeness="assertive" testId="notice-region" />
      <Header
        version={pack.packageVersion}
        updateStatus={state.updateStatus}
        onCheckUpdate={() => void handleCheckUpdate()}
      />
      <div className="app-body">
        <TopicList pack={pack} currentRoute={route} />
        <main id="main-content" ref={mainRef} className="main-content" tabIndex={-1}>
          {content}
          {canRollback && (
            <button
              type="button"
              className="text-button rollback-button"
              onClick={() => void handleRollback()}
            >
              回滚到上一版本
            </button>
          )}
        </main>
      </div>
    </div>
  );
}
