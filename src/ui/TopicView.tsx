import { useFocusOnRouteChange } from '../app/useFocusOnRouteChange';
import type { Route } from '../app/hashRoute';
import type { ContentRepository } from '../services/repository';

/** Topic detail: the topic's live articles in the package's stable order. */
export function TopicView({
  repository,
  topicId,
  navigate,
}: {
  repository: ContentRepository;
  topicId: string;
  navigate: (route: Route) => void;
}): JSX.Element {
  const headingRef = useFocusOnRouteChange<HTMLHeadingElement>(
    `topic:${topicId}`,
  );
  const topic = repository.topics.find((t) => t.id === topicId);

  if (topic === undefined) {
    return (
      <section aria-labelledby="topic-missing">
        <h1 id="topic-missing" tabIndex={-1} ref={headingRef}>
          未找到该主题
        </h1>
        <p>该主题可能已在新版本中调整。</p>
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

  return (
    <section aria-labelledby="topic-heading">
      <h1 id="topic-heading" tabIndex={-1} ref={headingRef}>
        {topic.title}
      </h1>
      <nav aria-label={`${topic.title} 条目`}>
        <ul className="article-list">
          {topic.articleIds.map((id) => {
            const article = repository.getArticle(id);
            if (article === undefined) {
              return null;
            }
            return (
              <li key={id}>
                <a
                  href={`#/article/${encodeURIComponent(id)}`}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate({ name: 'article', articleId: id });
                  }}
                >
                  {article.title}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </section>
  );
}
