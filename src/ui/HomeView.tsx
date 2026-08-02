import { useFocusOnRouteChange } from '../app/useFocusOnRouteChange';
import type { Route } from '../app/hashRoute';
import type { ContentRepository } from '../services/repository';

/** Home: list of topics. Each topic links to its detail view. */
export function HomeView({
  repository,
  navigate,
}: {
  repository: ContentRepository;
  navigate: (route: Route) => void;
}): JSX.Element {
  const headingRef = useFocusOnRouteChange<HTMLHeadingElement>('home');
  return (
    <section aria-labelledby="home-heading">
      <h1 id="home-heading" tabIndex={-1} ref={headingRef}>
        权益主题
      </h1>
      <p className="lede">选择一个主题浏览相关权益条目。</p>
      <nav aria-label="主题列表">
        <ul className="topic-list">
          {repository.topics.map((topic) => (
            <li key={topic.id}>
              <a
                href={`#/topic/${encodeURIComponent(topic.id)}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigate({ name: 'topic', topicId: topic.id });
                }}
              >
                <span className="topic-title">{topic.title}</span>
                <span className="topic-count">
                  {topic.articleIds.length} 篇
                </span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
