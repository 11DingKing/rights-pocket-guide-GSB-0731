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
| Signing | `src/core/signing.ts` | Ed25519 signature verify against pinned key | no |
| Storage | `src/storage/*` | IndexedDB schema + staging + **atomic CAS switch** | **yes** |
| Services | `src/services/*` | Orchestrate download→verify→signature→parse→resolve→index→stage→commit; manifest; repository | via storage only |
| Views | `src/ui/*`, `src/app/*` | React reader; consume `ContentRepository` only | **no** |

## Atomicity, rollback & concurrency

IndexedDB has three object stores: `packages` (committed snapshots), `staging`
(uncommitted work), and `meta` (the single `active` pointer + settings). An
update is staged into `staging` first — invisible to the repository, search, and
deep links — then promoted:

`PackageStore.promoteStaged` runs **one** `readwrite` transaction over all three
stores that (1) reads the current `active` pointer, (2) **compare-and-sets**
against the caller's `expectedActive` and aborts if it moved, (3) copies staged →
`packages`, (4) advances `active`, (5) deletes the staged copy. If any step
aborts — download/checksum/signature/parse/resolve/index/stage failure, a
`QuotaExceededError`, or a lost race — nothing visible changes and `active` still
names the previous **complete** version.

Because IndexedDB serializes `readwrite` transactions over `meta`, **two tabs**
racing to update are ordered: the first advances the pointer and commits; the
second's compare-and-set sees the moved pointer, aborts, and prunes its staged
copy. Exactly one version commits; the loser's staged chunks/index/temp metadata
are never reachable. A restart always shows a complete old package **or** a
complete new package — never a mix.

The **reading-settings schema** is versioned and coupled to the switch: schema 1
ships with the base package, schema 2 (adds `underlineLinks`) ships with the
delta. `promoteStaged` writes the migrated settings record in the *same*
transaction as the package + pointer (written last, so its failure rolls the
whole switch back). A forced restart therefore lands on {old package + old
settings} or {new package + new settings}, never a cross-version mix. Invalid
stored preferences are coerced to the last usable value (never thrown away), a
cyclic replacement chain renders an accessible `role="alert"` degraded state,
and a quota failure on save keeps the last usable settings — each surfaced with
a text+icon status badge and a live-region announcement.

Packages are verified twice before staging: **sha256** (corruption/truncation)
and **Ed25519 signature** against a public key pinned in the manifest and the
bundled seed (tampering). `scripts/build-manifest.mjs` signs each pack at build
time.

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
