import { useHashRoute } from '../app/useHashRoute';
import { useReadingSettings } from '../app/useReadingSettings';
import type { ContentRepository } from '../services/repository';
import type { UpdateError } from '../services/updateService';
import { ArticleView } from './ArticleView';
import { HomeView } from './HomeView';
import { SearchView } from './SearchView';
import { SettingsView } from './SettingsView';
import { StatusBadge } from './controls';
import { TopicView } from './TopicView';

export interface AppProps {
  readonly repository: ContentRepository;
  readonly activeVersion: string;
  readonly latestAttempted: string;
  readonly updateError?: UpdateError;
  readonly usedBundledSeed: boolean;
}

/** Root shell: skip link, header nav, offline/update status, and routed view. */
export function App({
  repository,
  activeVersion,
  latestAttempted,
  updateError,
  usedBundledSeed,
}: AppProps): JSX.Element {
  const { route, navigate } = useHashRoute();
  const { settings, update, status } = useReadingSettings(repository);

  const upToDate =
    updateError === undefined && activeVersion === latestAttempted;

  return (
    <>
      <a href="#main" className="skip-link">
        跳到主要内容
      </a>
      <header className="app-header">
        <nav aria-label="主导航" className="app-nav">
          <a
            href="#/"
            onClick={(event) => {
              event.preventDefault();
              navigate({ name: 'home' });
            }}
          >
            主题
          </a>
          <a
            href="#/search"
            onClick={(event) => {
              event.preventDefault();
              navigate({ name: 'search', query: '' });
            }}
          >
            检索
          </a>
          <a
            href="#/settings"
            onClick={(event) => {
              event.preventDefault();
              navigate({ name: 'settings' });
            }}
          >
            阅读设置
          </a>
        </nav>
        <div className="app-status">
          {upToDate ? (
            <StatusBadge tone="ok" glyph="✓">
              内容版本 {activeVersion}（最新）
            </StatusBadge>
          ) : (
            <StatusBadge tone="warn" glyph="!">
              内容版本 {activeVersion}（离线使用完整旧版本，更新未生效）
            </StatusBadge>
          )}
          {usedBundledSeed ? (
            <StatusBadge tone="info" glyph="⛶">
              首次离线启动，已加载内置内容包
            </StatusBadge>
          ) : null}
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        {route.name === 'home' ? (
          <HomeView repository={repository} navigate={navigate} />
        ) : null}
        {route.name === 'topic' ? (
          <TopicView
            repository={repository}
            topicId={route.topicId}
            navigate={navigate}
          />
        ) : null}
        {route.name === 'article' ? (
          <ArticleView
            repository={repository}
            articleId={route.articleId}
            navigate={navigate}
          />
        ) : null}
        {route.name === 'search' ? (
          <SearchView
            repository={repository}
            query={route.query}
            navigate={navigate}
          />
        ) : null}
        {route.name === 'settings' ? (
          <SettingsView
            settings={settings}
            update={update}
            status={status}
            schemaVersion={repository.settingsSchema}
          />
        ) : null}
      </main>
    </>
  );
}
