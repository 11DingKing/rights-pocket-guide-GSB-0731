import { useEffect } from 'react';
import { useAnnouncer } from '../app/Announcer';
import { useFocusOnRouteChange } from '../app/useFocusOnRouteChange';
import type { Route } from '../app/hashRoute';
import type { ContentRepository } from '../services/repository';
import { StatusBadge } from './controls';

/**
 * Article detail with deep-link migration. When the requested id has been
 * withdrawn, the repository resolves it to the replacement article: focus is
 * retained on the view heading (via useFocusOnRouteChange) and we announce
 * "内容已更新" to screen readers. A cyclic replacement chain (defensive) and an
 * unknown id each render an accessible, stable degraded state instead of a
 * blank or crashing view.
 */
export function ArticleView({
  repository,
  articleId,
  navigate,
}: {
  repository: ContentRepository;
  articleId: string;
  navigate: (route: Route) => void;
}): JSX.Element {
  const headingRef = useFocusOnRouteChange<HTMLHeadingElement>(
    `article:${articleId}`,
  );
  const { announce } = useAnnouncer();
  const target = repository.resolveDeepLink(articleId);
  const resolvedTitle =
    target.kind === 'resolved'
      ? repository.getArticle(target.articleId)?.title
      : undefined;
  // Depend on stable primitives so the announcement fires once per deep link,
  // not on every re-render (announcing re-renders the provider tree).
  const targetKind = target.kind;
  const migrated = target.kind === 'resolved' && target.migrated;
  const resolvedId = target.kind === 'resolved' ? target.articleId : '';

  useEffect(() => {
    switch (targetKind) {
      case 'resolved':
        if (migrated) {
          announce(`内容已更新，已跳转到替代条目：${resolvedTitle ?? resolvedId}`);
        }
        break;
      case 'cycle':
        announce('内容链接存在循环，已显示安全降级状态');
        break;
      case 'unknown':
        announce('未找到该条目');
        break;
      default:
        break;
    }
  }, [announce, targetKind, migrated, resolvedId, resolvedTitle]);

  // Degraded: cyclic replacement chain. Stable, accessible, non-colour-only.
  if (target.kind === 'cycle') {
    return (
      <section aria-labelledby="article-cycle" role="alert">
        <h1 id="article-cycle" tabIndex={-1} ref={headingRef}>
          内容暂时无法打开
        </h1>
        <p className="migration-notice">
          <StatusBadge tone="warn" glyph="!">
            该条目的替代链接出现循环，已进入安全降级状态。你的阅读设置未受影响。
          </StatusBadge>
        </p>
        <a
          href="#/"
          onClick={(event) => {
            event.preventDefault();
            navigate({ name: 'home' });
          }}
        >
          返回主题列表
        </a>
      </section>
    );
  }

  if (target.kind === 'unknown') {
    return (
      <section aria-labelledby="article-missing">
        <h1 id="article-missing" tabIndex={-1} ref={headingRef}>
          未找到该条目
        </h1>
        <p>该条目在当前版本中不存在。</p>
        <a
          href="#/"
          onClick={(event) => {
            event.preventDefault();
            navigate({ name: 'home' });
          }}
        >
          返回主题列表
        </a>
      </section>
    );
  }

  const article = repository.getArticle(target.articleId);
  if (article === undefined) {
    return (
      <section aria-labelledby="article-missing">
        <h1 id="article-missing" tabIndex={-1} ref={headingRef}>
          未找到该条目
        </h1>
      </section>
    );
  }

  return (
    <article aria-labelledby="article-heading">
      <h1 id="article-heading" tabIndex={-1} ref={headingRef}>
        {article.title}
      </h1>
      {target.migrated ? (
        <p className="migration-notice">
          <StatusBadge tone="info" glyph="↪">
            内容已更新：原条目（{target.requestedId}）已撤下，已为你跳转到替代条目。
          </StatusBadge>
        </p>
      ) : null}
      <p className="article-body">{article.body}</p>
      <dl className="legal-ref">
        <dt>法律依据</dt>
        <dd>{article.legalRef}</dd>
      </dl>
    </article>
  );
}
