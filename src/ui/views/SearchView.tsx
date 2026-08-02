import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Repository } from "../../services/repository";
import { useAnnouncer } from "../Announcer";
import { announcements } from "../announcements";
import { articleHash, navigateTo, searchHash } from "../router";
import { useHeadingFocus, useRepositorySnapshot } from "../hooks";

/**
 * 全文检索视图。输入即出结果；提交后把查询写入地址（深链接可分享）；
 * 结果数量同时以可见文本与 live region 公告（不只靠颜色/图标）。
 */
export function SearchView({
  repository,
  initialQuery,
}: {
  repository: Repository;
  initialQuery: string;
}) {
  const snapshot = useRepositorySnapshot(repository);
  const { announce } = useAnnouncer();
  const { headingRef } = useHeadingFocus(`search:${initialQuery}`);
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const trimmed = query.trim();
  const results = useMemo(
    () => (trimmed.length > 0 ? repository.searchArticles(trimmed) : []),
    [repository, trimmed, snapshot.packageVersion],
  );

  useEffect(() => {
    if (trimmed.length > 0) {
      announce(announcements.searchResults(results.length));
    }
  }, [announce, trimmed, results.length]);

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (trimmed.length > 0) {
      navigateTo(searchHash(trimmed));
    }
  };

  const onClear = (): void => {
    setQuery("");
    inputRef.current?.focus();
  };

  return (
    <section aria-labelledby="search-heading">
      <h1 id="search-heading" tabIndex={-1} ref={headingRef}>
        全文检索
      </h1>
      <form role="search" onSubmit={onSubmit}>
        <label htmlFor="search-input">搜索关键词</label>
        <div className="search-row">
          <input
            id="search-input"
            type="search"
            value={query}
            ref={inputRef}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
          />
          {query.length > 0 ? (
            <button type="button" aria-label="清除搜索" onClick={onClear}>
              ✕
            </button>
          ) : null}
          <button type="submit">搜索</button>
        </div>
      </form>
      <p className="meta" data-testid="result-count">
        {trimmed.length > 0
          ? `共 ${results.length} 条结果`
          : "输入关键词即可检索全部条目"}
      </p>
      <ul className="card-list" data-testid="search-results">
        {results.map(({ article }) => (
          <li key={article.id} className="card">
            <a href={articleHash(article.id)}>{article.title}</a>
            <span className="meta">法律依据：{article.legalRef}</span>
            <p className="snippet">{article.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
