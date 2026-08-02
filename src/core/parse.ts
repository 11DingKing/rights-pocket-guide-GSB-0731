/**
 * Parsing layer: turns untrusted JSON (`unknown`) into strongly-typed
 * `ParsedPackage` values. Pure and IO-free — it never touches the network or
 * IndexedDB. All access to unknown data goes through explicit guards so the
 * codebase stays free of `any` and non-null assertions.
 */
import type {
  DeltaChange,
  DeltaPackage,
  FullPackage,
  ParsedPackage,
  RawArticle,
  RawTopic,
} from './types';

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ParseError(`Expected non-empty string at ${path}`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return asString(value, path);
}

function asArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ParseError(`Expected array at ${path}`);
  }
  return value;
}

function parseTopic(value: unknown, path: string): RawTopic {
  if (!isRecord(value)) {
    throw new ParseError(`Expected object at ${path}`);
  }
  const articleIds = asArray(value['articleIds'], `${path}.articleIds`).map(
    (entry, i) => asString(entry, `${path}.articleIds[${i}]`),
  );
  return {
    id: asString(value['id'], `${path}.id`),
    title: asString(value['title'], `${path}.title`),
    articleIds,
  };
}

function parseArticle(value: unknown, path: string): RawArticle {
  if (!isRecord(value)) {
    throw new ParseError(`Expected object at ${path}`);
  }
  return {
    id: asString(value['id'], `${path}.id`),
    title: asString(value['title'], `${path}.title`),
    body: asString(value['body'], `${path}.body`),
    legalRef: asString(value['legalRef'], `${path}.legalRef`),
  };
}

function parseChange(value: unknown, path: string): DeltaChange {
  if (!isRecord(value)) {
    throw new ParseError(`Expected object at ${path}`);
  }
  const kind = asString(value['kind'], `${path}.kind`);
  switch (kind) {
    case 'REVISE':
      return {
        kind: 'REVISE',
        articleId: asString(value['articleId'], `${path}.articleId`),
        title: asString(value['title'], `${path}.title`),
        body: asString(value['body'], `${path}.body`),
        ...(value['legalRef'] === undefined
          ? {}
          : { legalRef: asString(value['legalRef'], `${path}.legalRef`) }),
      };
    case 'WITHDRAW':
      return {
        kind: 'WITHDRAW',
        articleId: asString(value['articleId'], `${path}.articleId`),
        replacementArticleId: asString(
          value['replacementArticleId'],
          `${path}.replacementArticleId`,
        ),
      };
    case 'ADD':
      return {
        kind: 'ADD',
        topicId: asString(value['topicId'], `${path}.topicId`),
        articleId: asString(value['articleId'], `${path}.articleId`),
        title: asString(value['title'], `${path}.title`),
        body: asString(value['body'], `${path}.body`),
        legalRef: asString(value['legalRef'], `${path}.legalRef`),
      };
    default:
      throw new ParseError(`Unknown change kind "${kind}" at ${path}.kind`);
  }
}

/** Parse a single JSON document (already `JSON.parse`d) into a package. */
export function parsePackage(value: unknown): ParsedPackage {
  if (!isRecord(value)) {
    throw new ParseError('Package must be a JSON object');
  }
  const packageVersion = asString(value['packageVersion'], 'packageVersion');

  // A delta package is identified by the presence of `changes`/`succeeds`.
  const hasChanges = value['changes'] !== undefined;
  const succeeds = optionalString(value['succeeds'], 'succeeds');

  if (hasChanges || succeeds !== undefined) {
    if (succeeds === undefined) {
      throw new ParseError('Delta package must declare "succeeds"');
    }
    const changes = asArray(value['changes'], 'changes').map((entry, i) =>
      parseChange(entry, `changes[${i}]`),
    );
    const delta: DeltaPackage = {
      kind: 'delta',
      packageVersion,
      succeeds,
      changes,
    };
    return delta;
  }

  const topics = asArray(value['topics'], 'topics').map((entry, i) =>
    parseTopic(entry, `topics[${i}]`),
  );
  const articles = asArray(value['articles'], 'articles').map((entry, i) =>
    parseArticle(entry, `articles[${i}]`),
  );
  const full: FullPackage = {
    kind: 'full',
    packageVersion,
    topics,
    articles,
  };
  return full;
}

/** Convenience: parse raw text. */
export function parsePackageText(text: string): ParsedPackage {
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ParseError(
      `Invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  return parsePackage(json);
}
