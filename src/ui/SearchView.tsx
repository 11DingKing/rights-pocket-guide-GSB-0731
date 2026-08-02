import { useEffect, useMemo, useState } from 'react';
import { useAnnouncer } from '../app/Announcer';
import { useFocusOnRouteChange } from '../app/useFocusOnRouteChange';
import type { Route } from '../app/hashRoute';
import type { ContentRepository } from '../services/repository';

/**
 * Full-text search view. The query lives in the URL so search results are
 * deep-linkable and survive reload. Result count is announced to screen
 * readers. Ranking is deterministic (see SearchIndex).
 */
export function SearchView({
  repository,
  query,
  navigate,
}: {
  repository: ContentRepository;
  query: string;
  navigate: (route: Route) => void;
}): JSX.Element {
  const headingRef = useFocusOnRouteChange<HTMLHeadingElement>('search');
  const { announce } = useAnnouncer();
  const [draft, setDraft] = useState(query);

  useEffect(() => {
    setDraft(query);
  }, [query]);

  const hits = useMemo(() => repository.search(query), [repository, query]);

  useEffect(() => {
    if (query.length > 0) {
      announce(`找到 ${hits.length} 条结果`);
    }
  }, [announce, hits.length, query]);

  return (
    <section aria-labelledby="search-heading">
      <h1 id="search-heading" tabIndex={-1} ref={headingRef}>
        全文检索
      </h1>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          navigate({ name: 'search', query: draft });
        }}
      >
        <label htmlFor="search-input">检索关键词</label>
        <input
          id="search-input"
          type="search"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          autoComplete="off"
        />
        <button type="submit">检索</button>
      </form>

      {query.length === 0 ? (
        <p className="lede">输入关键词以检索所有条目。</p>
      ) : (
        <>
          <p className="result-count">
            共 {hits.length} 条结果（关键词：{query}）
          </p>
          <ol className="search-results">
            {hits.map((hit) => {
              const article = repository.getArticle(hit.articleId);
              if (article === undefined) {
                return null;
              }
              return (
                <li key={hit.articleId}>
                  <a
                    href={`#/article/${encodeURIComponent(hit.articleId)}`}
                    onClick={(event) => {
                      event.preventDefault();
                      navigate({ name: 'article', articleId: hit.articleId });
                    }}
                  >
                    <span className="result-title">{article.title}</span>
                    <span className="result-ref">{article.legalRef}</span>
                  </a>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
