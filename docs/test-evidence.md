# Test Evidence

All evidence below is produced by automated tests. Reproduce the whole matrix
with:

```bash
npm test          # vitest run — 40 tests, all green
npm run build     # tsc -b (strict) + vite build
npm run dev       # manual smoke at http://localhost:5173
```

Latest run: **40 passed (7 files)**. Type-check (`tsc -b`) passes with `strict`,
`noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`; the source
contains no `any` and no non-null assertions.

---

## 1. Keyboard paths

Every step below is driven with the keyboard only (`user.tab()`,
`user.keyboard('{Enter}')`) — no pointer clicks in the path assertions.

| Path | Keys | Expected | Evidence (test) |
|------|------|----------|-----------------|
| Focus lands on content at load | (page load) | `<h1>权益主题</h1>` receives focus | `App.test.tsx › accessible reading flow › completes a full keyboard path` |
| Home → Topic | `Tab` → first topic link → `Enter` | Topic view opens, `<h1>法律援助</h1>` focused | same test |
| Topic → Article | `Tab` → first article link → `Enter` | Article view opens, its `<h1>` focused | same test |
| Search submit | focus search input → type `援助` → `Enter` | Results list rendered, count announced | `App.test.tsx › announces the search result count` |
| Route change focus restoration | activate `阅读设置` nav | `<h1>阅读设置</h1>` focused | `App.test.tsx › restores focus to the view heading on each route change` |

Focus restoration is implemented in `src/app/useFocusOnRouteChange.ts`; each
view `<h1>` has `tabIndex={-1}` so it can receive focus without joining the tab
order.

---

## 2. Screen-reader announcements

Announcements go through a polite live region (`role="status"`,
`aria-live="polite"`, `aria-atomic="true"`) in `src/app/Announcer.tsx`.

| Event | Announced text (pattern) | Evidence (test) |
|-------|--------------------------|-----------------|
| Search completes | `找到 N 条结果` | `App.test.tsx › announces the search result count via the live region` |
| Withdrawn deep link migrated | `原条目已撤下，已跳转到替代条目：…` | `App.test.tsx › migrates a withdrawn article deep link and announces it` |
| Update failed / offline | Status badge text `内容版本 … （离线使用完整旧版本，更新未生效）` + glyph `!` | `App.test.tsx › keeps the complete old package and shows a non-colour-only warning` |

State is never conveyed by colour alone: `StatusBadge` (`src/ui/controls.tsx`)
renders an icon glyph **and** a text label alongside the colour tone. Verified
by asserting both the text (`/更新未生效/`) and the glyph (`!`) are present.

---

## 3. Offline update

| Scenario | Expected | Evidence (test) |
|----------|----------|-----------------|
| First launch, no network | Boots from bundled seed to a complete package; content searchable offline | `bootstrap.test.ts › first offline launch uses the bundled seed › boots a complete package with no network` |
| Offline restart | Reopening the populated DB still shows the complete package offline | same test (second bootstrap) |
| Base install then advance to latest | `active = 2026.09.01`, redirect present | `updateService.test.ts › installs the base full package then advances to latest` |
| Successful update persists across restart | Reopen DB → complete new package (`ART-SERVICE-3` present, `ART-AID-2` gone) | `updateService.test.ts › after a successful update, reopening yields the complete new package` |

---

## 4. Update interruption & rollback (atomicity)

Each stage is interrupted via an injected `stageHook`; the checksum, signature,
and quota cases use corrupted bytes and a rejecting `promoteStaged`. In
**every** case the active pointer must still name the complete old version, the
new version's content must not be reachable, and the committed `packages` store
must hold only complete versions — no mixing, no partial snapshot.

| Interruption stage | Simulated fault | Post-condition | Evidence (test) |
|--------------------|-----------------|----------------|-----------------|
| `download` | throw before fetch completes | active = `2026.07.31`; `ART-AID-2` present, no redirect | `updateService.test.ts › rolls back cleanly when interrupted at "download"` |
| `verify` | throw at checksum stage | active = `2026.07.31` | `… interrupted at "verify"` |
| `signature` | throw at signature stage | active = `2026.07.31`; only old version committed | `… interrupted at "signature"` |
| `parse` | throw at parse stage | active = `2026.07.31` | `… interrupted at "parse"` |
| `resolve` | throw at resolve stage | active = `2026.07.31` | `… interrupted at "resolve"` |
| `index` | throw at index stage | active = `2026.07.31` | `… interrupted at "index"` |
| `stage` | throw entering staging | active = `2026.07.31`; nothing promoted | `… interrupted at "stage"` |
| `commit` | throw entering commit | active = `2026.07.31`; new content absent | `… interrupted at "commit"` |
| Checksum mismatch | corrupt v2 bytes | `UpdateError.stage === 'verify'`, active unchanged | `… treats a checksum mismatch as a failed download and keeps old version` |
| **Signature tampering** | flip a byte of v2's manifest signature | `UpdateError.stage === 'signature'`, active unchanged, only old version committed | `… rejects a tampered pack whose signature does not verify` |
| **IndexedDB quota exceeded** | `promoteStaged` rejects with `QuotaExceededError` | `UpdateError.stage === 'commit'`, active unchanged | `… survives a simulated IndexedDB quota error during commit` |
| Restart after failed update | interrupt at commit, reopen DB | complete old package only (`ART-AID-2` present, `ART-SERVICE-3` absent) | `… after a failed update, reopening the DB yields the complete old package` |

Every interruption case also asserts `listVersions() === ['2026.07.31']` — the
committed store never gains a half-written key. The atomic switch lives in
`PackageStore.promoteStaged` (`src/storage/packageStore.ts`): it reads the
active pointer, compare-and-sets against the caller's `expectedActive`, copies
staged → `packages`, advances the pointer, and deletes the staged copy, all in
ONE `readwrite` transaction over `staging`+`packages`+`meta`. `runTransaction`
resolves only on `oncomplete` (commit), so nothing is half-written.

Signature verification is a distinct stage layered on top of sha256: sha256
catches corruption/truncation, Ed25519 (`src/core/signing.ts`, pinned public key
from the manifest/bundled seed) catches tampering. A bad signature is treated
exactly like a failed download — nothing is staged.

---

## 5. Concurrency — two tabs updating at once

Each "tab" is a separate `PackageStore` connection to the same IndexedDB
database. Both start from a complete v1 and race to install v2. The
compare-and-set promotion serializes them: exactly one commits, and the loser's
staged snapshot / temp metadata is pruned and never becomes visible.

| Scenario | Expected | Evidence (test) |
|----------|----------|-----------------|
| Both tabs stage, then race the commit | exactly one promotes; loser fails with `UpdateError.stage === 'commit'` (StalePromotionError) | `concurrency.test.ts › commits exactly one version; the loser leaves nothing readable` |
| After the race | active = `2026.09.01` for both connections; `listStaged() === []`; committed store has only complete versions | same test |
| Loser's staged content | never reachable via repository/search/deep links (repository reads only the committed active package) | `concurrency.test.ts › a losing tab cannot expose staged content via search or deep links` |

---

## 6. v1 vs v2 comparison (same query, replacement relation, offline restart)

Computed only from the committed active package, identically on every run.

| Property | Expected | Evidence (test) |
|----------|----------|-----------------|
| Same query ranking for surviving article | `公证` ranks `ART-NOTARY-1` top with identical score in v1 and v2 | `comparison.test.ts › ranks a shared query identically for the surviving article` |
| Changes isolated to changed content | v1 `渠道` → `ART-AID-2`; v2 drops `ART-AID-2`, adds `ART-SERVICE-3` (searchable by `上门`) | `comparison.test.ts › differs only where content changed` |
| Withdrawn → replacement deep link | v1: `ART-AID-2` live, no migration; v2: `ART-AID-2 → ART-SERVICE-3`, identical every call | `comparison.test.ts › resolves the withdrawn→replacement deep link deterministically in v2 only` |
| Offline restart visible set | v2 visible article set `= [ART-AID-1, ART-NOTARY-1, ART-SERVICE-3]`, identical across restarts, `ART-AID-2` absent | `comparison.test.ts › offline restart shows the complete, deterministic visible set` |

---

## 7. Determinism across versions

| Property | Expected | Evidence (test) |
|----------|----------|-----------------|
| Search ranking reproducible | identical build → identical ranked hits | `search/index.test.ts › produces identical ranking on repeated builds` |
| Ranking stable across versions | surviving article ranks the same in v1 and v1+v2 | `search/index.test.ts › keeps ranking stable across versions for surviving articles` |
| Ordering rule | score desc, then article id asc | asserted inside the determinism test |
| Withdrawn deep link migration | `ART-AID-2 → ART-SERVICE-3`, unchanged ids do not migrate | `resolve.test.ts › migrates a withdrawn deep link to its replacement` |
| Reading settings persist across restart | `fontScale = large` survives re-bootstrap | `App.test.tsx › persists a font-scale change across a simulated restart` |

---

## 8. Reproducing the whole flow manually

1. `npm install`
2. `npm run dev` and open `http://localhost:5173`.
3. Confirm the status badge shows `内容版本 2026.09.01（最新）`.
4. Visit `#/article/ART-AID-2` — you are migrated to `行动不便时的上门服务`
   with a visible migration notice.
5. Search `援助` at `#/search` — deterministic results, count announced.
6. In `#/settings`, raise the font scale; reload — the setting persists.
7. To see rollback: throttle/deny the network in dev tools after first load and
   reload — the app keeps serving the complete cached package.
