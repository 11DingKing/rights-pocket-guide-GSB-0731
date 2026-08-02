import type { Article } from '../types';
import { LegalIcon } from './icons';

interface ArticleViewProps {
  article: Article;
}

export function ArticleView({ article }: ArticleViewProps) {
  return (
    <article className="article-view" aria-labelledby="article-heading">
      <h1 id="article-heading" tabIndex={-1} className="view-heading">
        {article.title}
      </h1>
      <p className="article-body">{article.body}</p>
      <footer className="legal-ref" aria-label="法律依据">
        <LegalIcon />
        <div>
          <span className="legal-ref-label">法律依据</span>
          <span className="legal-ref-text">{article.legalRef}</span>
        </div>
      </footer>
    </article>
  );
}
