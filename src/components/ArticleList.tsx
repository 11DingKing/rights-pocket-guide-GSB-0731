import type { MaterializedPack, Topic } from '../types';
import { navigate, routeToHash } from '../router/routes';
import { rememberFocus } from '../a11y/focusManager';
import type { Route } from '../router/routes';

interface ArticleListProps {
  pack: MaterializedPack;
  topic: Topic;
  currentRoute: Route;
}

export function ArticleList({ pack, topic, currentRoute }: ArticleListProps) {
  return (
    <section className="article-list" aria-labelledby="article-list-heading">
      <h1 id="article-list-heading" tabIndex={-1} className="view-heading">
        {topic.title}
      </h1>
      <p className="list-meta">共 {topic.articleIds.length} 篇文章</p>
      <ul className="article-link-list">
        {topic.articleIds.map((articleId) => {
          const article = pack.articles[articleId];
          if (article === undefined) return null;
          return (
            <li key={article.id}>
              <a
                href={routeToHash({ name: 'article', articleId: article.id })}
                className="article-link"
                onFocus={(event) =>
                  rememberFocus(currentRoute, event.currentTarget)
                }
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey) return;
                  event.preventDefault();
                  rememberFocus(currentRoute, event.currentTarget);
                  navigate({ name: 'article', articleId: article.id });
                }}
              >
                <span className="article-link-title">{article.title}</span>
                <span className="article-link-ref">{article.legalRef}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
