import type { Repository } from "../../services/repository";
import { articleHash, topicHash } from "../router";
import { useHeadingFocus, useRepositorySnapshot } from "../hooks";

export function TopicsView({ repository }: { repository: Repository }) {
  const snapshot = useRepositorySnapshot(repository);
  const { headingRef } = useHeadingFocus("topics");
  return (
    <section aria-labelledby="topics-heading">
      <h1 id="topics-heading" tabIndex={-1} ref={headingRef}>
        主题浏览
      </h1>
      <ul className="card-list">
        {snapshot.topics.map((topic) => (
          <li key={topic.id} className="card">
            <a href={topicHash(topic.id)}>{topic.title}</a>
            <span className="meta">（共 {topic.articleIds.length} 篇）</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TopicView({
  repository,
  topicId,
}: {
  repository: Repository;
  topicId: string;
}) {
  const { headingRef } = useHeadingFocus(topicId);
  const topic = repository.getTopic(topicId);
  if (topic === undefined) {
    return (
      <section aria-labelledby="topic-missing-heading">
        <h1 id="topic-missing-heading" tabIndex={-1} ref={headingRef}>
          主题不存在
        </h1>
        <p>该主题在当前内容版本中不存在。</p>
        <a href="#/">返回主题浏览</a>
      </section>
    );
  }
  return (
    <section aria-labelledby="topic-heading">
      <h1 id="topic-heading" tabIndex={-1} ref={headingRef}>
        {topic.title}
      </h1>
      <ul className="card-list">
        {topic.articleIds.map((articleId) => {
          const article = repository.getArticle(articleId);
          if (article === undefined) {
            return null;
          }
          return (
            <li key={article.id} className="card">
              <a href={articleHash(article.id)}>{article.title}</a>
              <span className="meta">法律依据：{article.legalRef}</span>
            </li>
          );
        })}
      </ul>
      <p>
        <a href="#/">返回主题浏览</a>
      </p>
    </section>
  );
}
