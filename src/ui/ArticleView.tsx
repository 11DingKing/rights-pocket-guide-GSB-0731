import { useEffect } from 'react';
import { useAnnouncer } from '../app/Announcer';
import { useFocusOnRouteChange } from '../app/useFocusOnRouteChange';
import type { Route } from '../app/hashRoute';
import type { ContentRepository } from '../services/repository';
import { StatusBadge } from './controls';

/**
 * Article detail with deep-link migration. When the requested id has been
 * withdrawn, the repository resolves it to the replacement article; we show a
 * clearly-labelled migration notice (icon + text, not colour-only) and
 * announce it to screen readers.
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

  useEffect(() => {
    if (target === undefined) {
      announce('未找到该条目');
    } else if (target.migrated) {
      const article = repository.getArticle(target.articleId);
      announce(
        `原条目已撤下，已跳转到替代条目：${article?.title ?? target.articleId}`,
      );
    }
  }, [announce, repository, target, articleId]);

  if (target === undefined) {
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
            原条目（{target.requestedId}）已撤下，已为你跳转到替代条目。
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
