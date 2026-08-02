import { useMemo } from 'react';
import type { MaterializedPack, SearchHit } from '../types';
import { navigate, routeToHash } from '../router/routes';
import { rememberFocus } from '../a11y/focusManager';
import type { Route } from '../router/routes';

interface SearchResultsProps {
  pack: MaterializedPack;
  query: string;
  hits: ReadonlyArray<SearchHit>;
  currentRoute: Route;
}

const FIELD_LABELS: Readonly<Record<'title' | 'body' | 'legalRef', string>> = {
  title: '标题',
  body: '正文',
  legalRef: '法律依据',
};

export function SearchResults({ pack, query, hits, currentRoute }: SearchResultsProps) {
  const trimmed = query.trim();
  const headingText = useMemo(() => {
    if (trimmed.length === 0) return '搜索';
    return `“${trimmed}”的搜索结果：${hits.length} 条`;
  }, [trimmed, hits.length]);

  return (
    <section className="search-results" aria-labelledby="search-heading">
      <h1 id="search-heading" tabIndex={-1} className="view-heading">
        {headingText}
      </h1>
      {trimmed.length === 0 ? (
        <p>请输入关键词进行搜索。</p>
      ) : hits.length === 0 ? (
        <p>没有找到相关内容。</p>
      ) : (
        <ul className="article-link-list">
          {hits.map((hit) => {
            const article = pack.articles[hit.articleId];
            if (article === undefined) return null;
            return (
              <li key={hit.articleId}>
                <a
                  href={routeToHash({ name: 'article', articleId: hit.articleId })}
                  className="article-link"
                  onFocus={(event) =>
                    rememberFocus(currentRoute, event.currentTarget)
                  }
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey) return;
                    event.preventDefault();
                    rememberFocus(currentRoute, event.currentTarget);
                    navigate({ name: 'article', articleId: hit.articleId });
                  }}
                >
                  <span className="article-link-title">{article.title}</span>
                  <span className="search-meta">
                    <span className="search-fields">
                      {hit.matchedFields.map((field) => FIELD_LABELS[field]).join('、')}
                    </span>
                    <span className="article-link-ref">{article.legalRef}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
