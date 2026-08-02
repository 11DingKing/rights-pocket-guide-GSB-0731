import type { Repository } from "../../services/repository";
import { articleHash } from "../router";
import { useHeadingFocus, useRepositorySnapshot } from "../hooks";

/** 法律依据索引：按法条聚合当前版本全部有效条目。 */
export function LegalView({ repository }: { repository: Repository }) {
  const snapshot = useRepositorySnapshot(repository);
  const { headingRef } = useHeadingFocus(
    `legal:${snapshot.packageVersion ?? ""}`,
  );
  const groups = repository.listLegalRefs();
  return (
    <section aria-labelledby="legal-heading">
      <h1 id="legal-heading" tabIndex={-1} ref={headingRef}>
        法律依据
      </h1>
      {groups.map((group) => (
        <section
          key={group.legalRef}
          aria-labelledby={`legal-${group.legalRef}`}
        >
          <h2 id={`legal-${group.legalRef}`}>{group.legalRef}</h2>
          <ul className="card-list">
            {group.articles.map((article) => (
              <li key={article.id} className="card">
                <a href={articleHash(article.id)}>{article.title}</a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
