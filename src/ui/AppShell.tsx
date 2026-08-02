import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { Repository, RepositorySnapshot } from "../services/repository";
import { AnnouncerProvider, useAnnouncer } from "./Announcer";
import { announcements } from "./announcements";
import { useRepositorySnapshot } from "./hooks";
import { useRoute } from "./router";
import { TopicsView, TopicView } from "./views/TopicsView";
import { ArticleView } from "./views/ArticleView";
import { SearchView } from "./views/SearchView";
import { LegalView } from "./views/LegalView";
import { SettingsView } from "./views/SettingsView";

function updateStatusText(snapshot: RepositorySnapshot): string {
  switch (snapshot.updateStatus) {
    case "checking":
      return "正在检查更新…";
    case "updated":
      return `已更新到 ${snapshot.updateMessage ?? ""}`;
    case "already-current":
      return "已是最新版本";
    case "failed":
      return `更新失败（${snapshot.updateMessage ?? ""}），仍使用旧版本 ${snapshot.packageVersion ?? ""}`;
    case "rolled-back":
      return `已回滚到 ${snapshot.updateMessage ?? ""}`;
    case "idle":
      return "";
  }
}

function UpdateControl({ repository }: { repository: Repository }) {
  const snapshot = useRepositorySnapshot(repository);
  const { announce } = useAnnouncer();
  const busy = snapshot.updateStatus === "checking";

  const onClick = (): void => {
    void repository.checkForUpdates().then((result) => {
      if (result.status === "updated") {
        announce(announcements.updated(result.toVersion));
      } else if (result.status === "already-current") {
        announce(announcements.alreadyCurrent(result.activeVersion));
      } else {
        announce(announcements.updateFailed(result.activeVersion), {
          assertive: true,
        });
      }
    });
  };

  const statusText = updateStatusText(snapshot);
  return (
    <div className="update-control">
      <span className="version-badge" data-testid="version-badge">
        <span aria-hidden="true" className="dot">
          ●
        </span>
        当前版本 {snapshot.packageVersion ?? "加载中"}
      </span>
      <button type="button" onClick={onClick} disabled={busy}>
        {busy ? "正在检查更新…" : "检查更新"}
      </button>
      {statusText.length > 0 ? (
        <span className="update-status-text" data-testid="update-status">
          {statusText}
        </span>
      ) : null}
    </div>
  );
}

function NotFoundView() {
  return (
    <section aria-labelledby="notfound-heading">
      <h1 id="notfound-heading" tabIndex={-1}>
        页面不存在
      </h1>
      <p>地址无效。</p>
      <a href="#/">返回主题浏览</a>
    </section>
  );
}

function Shell({ repository }: { repository: Repository }) {
  const route = useRoute();
  const snapshot = useRepositorySnapshot(repository);
  const mainRef = useRef<HTMLElement | null>(null);

  // 阅读设置应用到根元素（CSS 变量随 data 属性切换；字间距为 schema 2 字段）。
  useEffect(() => {
    const root = document.documentElement;
    const { settings } = snapshot;
    root.dataset['theme'] = settings.values.theme;
    root.dataset['fontScale'] = settings.values.fontScale;
    root.dataset['lineSpacing'] = settings.values.lineSpacing;
    root.dataset['letterSpacing'] =
      settings.schemaVersion === 2 ? settings.values.letterSpacing : 'standard';
  }, [snapshot.settings]);

  // 更新/回滚完成后，把焦点确定性恢复到当前页主标题。
  useEffect(() => {
    if (
      snapshot.updateStatus === "updated" ||
      snapshot.updateStatus === "rolled-back"
    ) {
      document.querySelector<HTMLHeadingElement>("main h1")?.focus();
    }
  }, [snapshot.updateStatus, snapshot.packageVersion]);

  let view: ReactNode;
  if (snapshot.loadStatus === "loading") {
    view = <p>正在加载内容…</p>;
  } else if (snapshot.loadStatus === "error") {
    view = (
      <p role="alert">内容加载失败：{snapshot.errorMessage ?? "未知错误"}</p>
    );
  } else if (route.name === "topics") {
    view = <TopicsView repository={repository} />;
  } else if (route.name === "topic") {
    view = <TopicView repository={repository} topicId={route.topicId} />;
  } else if (route.name === "article") {
    view = <ArticleView repository={repository} articleId={route.articleId} />;
  } else if (route.name === "search") {
    view = <SearchView repository={repository} initialQuery={route.query} />;
  } else if (route.name === "legal") {
    view = <LegalView repository={repository} />;
  } else if (route.name === "settings") {
    view = <SettingsView repository={repository} />;
  } else {
    view = <NotFoundView />;
  }

  const navCurrent = (names: string[]): "page" | undefined =>
    names.includes(route.name) ? "page" : undefined;

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        跳到主要内容
      </a>
      <header className="app-header">
        <span className="app-title">无障碍权益口袋指南</span>
        <nav aria-label="主导航">
          <ul>
            <li>
              <a
                href="#/"
                aria-current={navCurrent(["topics", "topic", "article"])}
              >
                主题
              </a>
            </li>
            <li>
              <a href="#/search" aria-current={navCurrent(["search"])}>
                检索
              </a>
            </li>
            <li>
              <a href="#/legal" aria-current={navCurrent(["legal"])}>
                法律依据
              </a>
            </li>
            <li>
              <a href="#/settings" aria-current={navCurrent(["settings"])}>
                设置
              </a>
            </li>
          </ul>
        </nav>
        <UpdateControl repository={repository} />
      </header>
      <main id="main-content" tabIndex={-1} ref={mainRef}>
        {view}
      </main>
    </div>
  );
}

export function AppShell({ repository }: { repository: Repository }) {
  return (
    <AnnouncerProvider>
      <Shell repository={repository} />
    </AnnouncerProvider>
  );
}
