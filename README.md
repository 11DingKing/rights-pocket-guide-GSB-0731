# Rights Pocket Guide · 无障碍权益随身指南

An offline-first, accessible reader for fixed legal-rights content packages.
Content packages are versioned and switched **atomically**: a failed update
never mixes old and new content — the app keeps a complete old package until a
complete new package is committed.

Built with **React + TypeScript (strict) + Vite + IndexedDB**. No UI component
library, no full-text-search library, and no state-management library.

## Quick start

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm run build      # type-check + production build to dist/
npm test           # vitest run (31 tests)
```

`predev`/`prebuild` run `scripts/build-manifest.mjs`, which copies the canonical
packs from `materials/` into `public/materials/`, computes each pack's SHA-256,
writes `manifest.json`, and generates `src/bundled/seed.ts` so the **first
launch works fully offline**.

## Architecture (strict layering)

Views never touch IndexedDB, `fetch`, parsing, or indexing directly. Each arrow
is a one-way dependency:

```
materials/*.json ─► parse ─► resolve ─► index ─┐
                                               ▼
        fetch ─► verify(sha256) ─► updateService ─► IndexedDB (storage)
                                               │
                                               ▼
                                     ContentRepository  ◄── React views
```

| Layer | Location | Responsibility | Knows about IndexedDB? |
|-------|----------|----------------|------------------------|
| Domain types | `src/core/types.ts` | Shared shapes | no |
| Parsing | `src/core/parse.ts` | `unknown` JSON → typed packages (guards, no `any`) | no |
| Resolution | `src/core/resolve.ts` | Fold full + delta chain → one `ResolvedSnapshot`; withdrawals → redirects | no |
| Indexing | `src/core/search/index.ts` | Deterministic inverted index + ranking | no |
| Checksum | `src/core/checksum.ts` | SHA-256 verify (SubtleCrypto) | no |
| Storage | `src/storage/*` | IndexedDB schema + **atomic switch** | **yes** |
| Services | `src/services/*` | Orchestrate download→verify→parse→resolve→index→commit; manifest; repository | via storage only |
| Views | `src/ui/*`, `src/app/*` | React reader; consume `ContentRepository` only | **no** |

## Atomicity & rollback

The switch writes the new snapshot **and** advances the single `active` pointer
inside **one** IndexedDB read/write transaction spanning both object stores
(`packages`, `meta`). If anything aborts — download interrupted, checksum
mismatch, parse/resolve/index failure, or a `QuotaExceededError` mid-commit —
the transaction rolls back and the `active` pointer still names the previous
**complete** version. Downstream reads only ever load the package the pointer
names, so a restart shows a complete old package **or** a complete new package,
never a mix.

## Content model

- `materials/content-pack-v1.json` — full base package (`packageVersion 2026.07.31`).
- `materials/content-pack-v2.json` — delta (`succeeds 2026.07.31`) with
  `REVISE`, `WITHDRAW` (→ `replacementArticleId`), and `ADD` changes.

Withdrawn articles are removed from topics and search but leave a **redirect**
so deep links to retired articles (`#/article/ART-AID-2`) migrate
deterministically to their replacement (`ART-SERVICE-3`).

## Deep links (hash routing, works from `file://`)

| Hash | View |
|------|------|
| `#/` | Topic list |
| `#/topic/TOPIC-AID` | Topic detail |
| `#/article/ART-AID-1` | Article (withdrawn ids migrate on load) |
| `#/search?q=援助` | Full-text search results |
| `#/settings` | Reading settings |

## Accessibility

- Skip link, one `<h1>` per view, focus moves to that heading on every route
  change (`useFocusOnRouteChange`).
- Icon-only controls must go through `IconButton`, which requires an
  `aria-label` — no unnamed icon buttons can ship.
- State is never colour-only: `StatusBadge` pairs an icon glyph **and** text
  with the colour.
- Live region (`role="status"`, `aria-live="polite"`) announces search counts,
  deep-link migration, and update outcome.
- Reading settings (font scale, contrast, line spacing) persist independently of
  content packages and survive version switches.

## Verification

See [docs/test-evidence.md](docs/test-evidence.md) for the reproducible test
matrix (keyboard paths, screen-reader announcements, offline update, rollback,
quota, deep-link migration).

```bash
npm test            # 31 automated tests
npm run build       # tsc -b (strict) + vite build
npm run dev         # manual smoke
```
