import type { MaterializedPack } from '../types';
import { navigate, routeToHash } from '../router/routes';
import { rememberFocus } from '../a11y/focusManager';
import type { Route } from '../router/routes';

interface TopicListProps {
  pack: MaterializedPack;
  currentRoute: Route;
}

export function TopicList({ pack, currentRoute }: TopicListProps) {
  const activeTopicId =
    currentRoute.name === 'topic' ? currentRoute.topicId : null;

  return (
    <nav className="sidebar" aria-label="主题导航">
      <h2 className="sidebar-heading">主题</h2>
      <ul className="topic-list">
        {pack.topics.map((topic) => {
          const isActive = topic.id === activeTopicId;
          return (
            <li key={topic.id}>
              <a
                href={routeToHash({ name: 'topic', topicId: topic.id })}
                className="topic-link"
                aria-current={isActive ? 'page' : undefined}
                onFocus={(event) =>
                  rememberFocus(currentRoute, event.currentTarget)
                }
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey) return;
                  event.preventDefault();
                  rememberFocus(currentRoute, event.currentTarget);
                  navigate({ name: 'topic', topicId: topic.id });
                }}
              >
                {topic.title}
                <span className="topic-count" aria-label={`${topic.articleIds.length} 篇文章`}>
                  {topic.articleIds.length}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
