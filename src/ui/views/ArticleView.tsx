import { useEffect } from 'react';
import type { Repository } from '../../services/repository';
import { useAnnouncer } from '../Announcer';
import { announcements } from '../announcements';
import { articleHash, replaceWith, topicHash } from '../router';
import { useHeadingFocus, useRepositorySnapshot } from '../hooks';

/**
 * 条目视图。撤下条目的深链接会被确定性地重定向到替代条目：
 * 先公告（内容经更新而来时带“内容已更新”前缀），再替换地址，
 * 最后焦点落到新条目标题。替代链成环时渲染稳定的降级页面。
 */
export function ArticleView({
  repository,
  articleId
}: {
  repository: Repository;
  articleId: string;
}) {
  const snapshot = useRepositorySnapshot(repository);
  const { announce } = useAnnouncer();
  const resolution = repository.resolveArticleLink(articleId);
  const focusKey = `${snapshot.packageVersion ?? ''}:${articleId}:${resolution.kind}`;
  const { headingRef } = useHeadingFocus(focusKey);

  useEffect(() => {
    if (resolution.kind === 'redirect') {
      announce(announcements.withdrawnRedirect(repository.contentWasUpdated()), {
        assertive: true
      });
      replaceWith(articleHash(resolution.article.id));
    } else if (resolution.kind === 'broken') {
      announce(announcements.brokenRedirect, { assertive: true });
    }
  }, [resolution, announce, repository]);

  if (resolution.kind === 'redirect') {
    return (
      <section aria-labelledby="redirect-heading">
        <h1 id="redirect-heading" tabIndex={-1}>
          正在跳转到替代条目…
        </h1>
      </section>
    );
  }

  if (resolution.kind === 'broken') {
    return (
      <section aria-labelledby="broken-heading" data-testid="broken-link">
        <h1 id="broken-heading" tabIndex={-1} ref={headingRef}>
          条目暂时不可用
        </h1>
        <p>该条目的替代关系存在异常。其余内容不受影响，可以继续浏览。</p>
        <a href="#/">返回主题浏览</a>
      </section>
    );
  }

  if (resolution.kind === 'missing') {
    return (
      <section aria-labelledby="missing-heading">
        <h1 id="missing-heading" tabIndex={-1} ref={headingRef}>
          条目不存在
        </h1>
        <p>该条目在当前内容版本中不存在，且没有可用的替代条目。</p>
        <a href="#/">返回主题浏览</a>
      </section>
    );
  }

  const { article } = resolution;
  const topic = repository.findTopicOfArticle(article.id);
  return (
    <article aria-labelledby="article-heading">
      <h1 id="article-heading" tabIndex={-1} ref={headingRef}>
        {article.title}
      </h1>
      <p className="article-body">{article.body}</p>
      <section aria-labelledby="article-legal-heading" className="legal-section">
        <h2 id="article-legal-heading">法律依据</h2>
        <p>{article.legalRef}</p>
        <p>
          <a href="#/legal">查看全部法律依据</a>
        </p>
      </section>
      {topic !== undefined ? (
        <p>
          <a href={topicHash(topic.id)}>返回主题：{topic.title}</a>
        </p>
      ) : null}
    </article>
  );
}
