# Test Evidence

All evidence below is produced by automated tests. Reproduce the whole matrix
with:

```bash
npm test          # vitest run — 31 tests, all green
npm run build     # tsc -b (strict) + vite build
npm run dev       # manual smoke at http://localhost:5173
```

Latest run: **31 passed (5 files)**. Type-check (`tsc -b`) passes with `strict`,
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

Each stage is interrupted via an injected `stageHook`; the checksum and quota
cases use corrupted bytes and a rejecting `commitActivePackage`. In **every**
case the active pointer must still name the complete old version, and the new
version's content must not be reachable — no mixing.

| Interruption stage | Simulated fault | Post-condition | Evidence (test) |
|--------------------|-----------------|----------------|-----------------|
| `download` | throw before fetch completes | active = `2026.07.31`; `ART-AID-2` present, no redirect | `updateService.test.ts › rolls back cleanly when interrupted at "download"` |
| `verify` | throw at checksum stage | active = `2026.07.31` | `… interrupted at "verify"` |
| `parse` | throw at parse stage | active = `2026.07.31` | `… interrupted at "parse"` |
| `resolve` | throw at resolve stage | active = `2026.07.31` | `… interrupted at "resolve"` |
| `index` | throw at index stage | active = `2026.07.31` | `… interrupted at "index"` |
| `commit` | throw entering commit | active = `2026.07.31`; new content absent | `… interrupted at "commit"` |
| Checksum mismatch | corrupt v2 bytes | `UpdateError.stage === 'verify'`, active unchanged | `… treats a checksum mismatch as a failed download and keeps old version` |
| **IndexedDB quota exceeded** | `commitActivePackage` rejects with `QuotaExceededError` | `UpdateError.stage === 'commit'`, active unchanged | `… survives a simulated IndexedDB quota error during commit` |
| Restart after failed update | interrupt at commit, reopen DB | complete old package only (`ART-AID-2` present, `ART-SERVICE-3` absent) | `… after a failed update, reopening the DB yields the complete old package` |

The atomic switch lives in `PackageStore.commitActivePackage`
(`src/storage/packageStore.ts`): the package `put` and the `active` pointer
`put` share one `readwrite` transaction over both object stores, and
`runTransaction` resolves only on `oncomplete` (commit), rejecting/aborting on
error so nothing is half-written.

---

## 5. Determinism across versions

| Property | Expected | Evidence (test) |
|----------|----------|-----------------|
| Search ranking reproducible | identical build → identical ranked hits | `search/index.test.ts › produces identical ranking on repeated builds` |
| Ranking stable across versions | surviving article ranks the same in v1 and v1+v2 | `search/index.test.ts › keeps ranking stable across versions for surviving articles` |
| Ordering rule | score desc, then article id asc | asserted inside the determinism test |
| Withdrawn deep link migration | `ART-AID-2 → ART-SERVICE-3`, unchanged ids do not migrate | `resolve.test.ts › migrates a withdrawn deep link to its replacement` |
| Reading settings persist across restart | `fontScale = large` survives re-bootstrap | `App.test.tsx › persists a font-scale change across a simulated restart` |

---

## 6. Reproducing the whole flow manually

1. `npm install`
2. `npm run dev` and open `http://localhost:5173`.
3. Confirm the status badge shows `内容版本 2026.09.01（最新）`.
4. Visit `#/article/ART-AID-2` — you are migrated to `行动不便时的上门服务`
   with a visible migration notice.
5. Search `援助` at `#/search` — deterministic results, count announced.
6. In `#/settings`, raise the font scale; reload — the setting persists.
7. To see rollback: throttle/deny the network in dev tools after first load and
   reload — the app keeps serving the complete cached package.
