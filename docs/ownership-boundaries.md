# Ownership boundaries

This repository is a fork of [`agegr/pi-web`](https://github.com/agegr/pi-web) that
packages it, together with the [`earendil-works/pi`](https://github.com/earendil-works/pi)
SDK, into a signed desktop app. Three layers, three integration mechanisms:

| Layer | Source | How it arrives | Who owns the files |
|---|---|---|---|
| Agent runtime | `@earendil-works/pi-*` | npm dependency, exact version | upstream |
| Web UI | `agegr/pi-web` | `git merge` of an upstream release tag | upstream |
| Desktop shell | this repo | authored here | fork |

The whole maintenance cost of this project is concentrated in one place: **files the
fork edits that upstream also owns.** Everything in this document exists to keep that
set small and visible.

## The machine-readable boundary

[`scripts/fork-ownership.json`](../scripts/fork-ownership.json) is the single source of
truth. It is consumed by:

- `.github/workflows/component-updates.yml` — decides whether a nightly sync may push
  to `main` unattended or must open a PR for review.
- `scripts/fork-ownership.test.mjs` — fails if the manifest drifts from the tree.

Update the manifest in the same commit that changes the boundary. Do not maintain a
second copy of this list anywhere.

## Cosmetic drift vs structural drift

Not all divergence costs the same, and line count is a bad proxy for risk.

pi-web styles its components with inline `style={{ … }}` objects, which a stylesheet
cannot override. So restyling a shared component *necessarily* edits the upstream file:
you delete the inline style and add a `className`. That produces a large diff — and it
is fine. If upstream later edits the same line, git reports a textual conflict, the sync
job fails, and a human looks at it. Loud failure is the safe failure.

What is dangerous is **structural** drift: rewritten JSX trees, new components spliced
into upstream files, and logic moved across file boundaries. Those merge *cleanly* while
being wrong.

`npm run drift` measures the split and flags any file whose recorded risk no longer
matches:

```
components/ModelsConfig.tsx     146 total    134 cosmetic     12 structural   low
components/AppShell.tsx         558 total    129 cosmetic    429 structural   high
```

Both files have big diffs. Only one of them is a problem. `ModelsConfig.tsx` is the
reference for how a restyled shared component should look.

Risk thresholds live in the manifest's `riskModel` and are applied to structural drift
only: `>= 250` high, `>= 30` medium, below that low.

### Where the structural drift actually is

Across the whole fork: **973 cosmetic lines, 1462 structural**. But the structural half
is highly concentrated — four files carry 86% of it:

| File | structural | why |
|---|---|---|
| `components/SessionSidebar.tsx` | 430 | ~500 lines moved out to `ProjectPicker.tsx` / `path-ui.tsx` |
| `components/AppShell.tsx` | 429 | title bar, window controls, top-bar restructure |
| `components/FileViewer.tsx` | 305 | new toolbar/status components, inline SVG |
| `components/TabBar.tsx` | 66 | tab chrome rebuilt |

Every other shared component is already in acceptable shape. Reverting work should target
these four and nothing else — `TabBar.tsx` first, since it is the smallest.

## The failure mode this guards against

`git merge` conflicts are the *safe* outcome — the sync workflow runs under
`set -euo pipefail`, so a conflict fails the job and nothing ships.

The dangerous outcome is a **silent semantic conflict**: upstream edits a region the
fork also changed, git merges it cleanly because the edits do not textually overlap,
and the result is two implementations of the same behaviour. Tests, `tsc --noEmit`
and `eslint` all pass, and the previous pipeline pushed that straight to `main` and
cut a signed release with no human in the loop.

The worst instance today is `components/SessionSidebar.tsx`: roughly 500 lines were
moved out into `components/ProjectPicker.tsx` and `components/path-ui.tsx`, neither of
which exists upstream. Git does not track cross-file moves, so an upstream change to
the project-picker block merges back into `SessionSidebar.tsx` cleanly and resurrects
a second copy of code that now lives in `ProjectPicker.tsx`.

Concrete measurement: upstream's `v0.8.0 → v0.8.1` patch release touched **7 files
that this fork has also modified**, including all three of the highest-risk ones.
Expect roughly a third of the files in any upstream release to land on fork-modified
files until the structural drift is reverted.

## Rules for changing a shared file

In order of preference:

1. **Style only?** Put the CSS in `app/native-theme.css` and, in the upstream component,
   replace the inline `style={{ … }}` with a `className` — nothing else. Deleting the
   inline style is unavoidable (a stylesheet cannot override it) and is not a boundary
   violation; leaving the JSX shape untouched is the part that matters.
   `app/globals.css` stays byte-identical to upstream — never edit it.
   `native-theme.css` is imported after it in `app/layout.tsx` so equal-specificity
   rules win.
2. **Generally useful?** Send it upstream to `agegr/pi-web` as a PR. Once merged, the
   structural divergence disappears entirely. This is the only real fix, and it is the
   right home for things like the `ProjectPicker` extraction, the `FileViewer` toolbar,
   and `hooks/useTheme.ts` following `prefers-color-scheme`.
3. **Genuinely desktop-only?** Put it in a fork-owned file and reach it from the
   upstream file with a single import plus one `isTauriDesktop()` branch. Never restructure
   upstream JSX to accommodate it.

What to avoid: rewriting upstream JSX for visual reasons, and moving upstream code
across file boundaries.

## Fork-owned files

Safe to edit freely; upstream never touches them. Full list in the manifest's
`forkOwnedPaths`. Broadly: `src-tauri/`, `desktop/`, `scripts/`, `.github/workflows/`,
`app/native-theme.css`, `app/api/updates/`, `lib/branding.ts`, `lib/app-updates.ts`,
`lib/desktop-updater.ts`, `lib/desktop-window.ts`, and the desktop-only components
(`ProjectPicker`, `UpdateReminder`, `AppSettings`, `path-ui`).

## Deliberate decisions that look like mistakes

- **`package.json` is still named `@agegr/pi-web`.** This is intentional. Upstream
  edits its own name and version on every release; renaming the fork would produce a
  conflict in `package.json` on every single sync. The user-facing brand comes from
  `lib/branding.ts` and `src-tauri/tauri.conf.json` instead. (JSON has no comments,
  which is why this note lives here.)
- **`next.config.ts` keeps its hand-written `serverExternalPackages` list.** It is
  tempting to derive it from `package.json`, but this file is upstream-owned and
  upstream updates that list itself when it adds a pi package. Auto-deriving it here
  would manufacture a conflict on every release. The fork-owned copies of that list are
  derived instead — `scripts/pi-packages.mjs` reads `package.json` and feeds both
  `scripts/prepare-desktop.mjs` and the sync workflow, so adding a pi package cannot
  leave one of them behind.
- **`AGENTS.md` is an upstream file.** It does not mention Tauri and should not. Put
  desktop maintenance notes in `docs/` and, at most, leave a one-line pointer there.
- **Local builds do not register the updater.** `src-tauri` reads the public key via
  `option_env!`, so a build without `PI_AGENT_DESKTOP_UPDATER_PUBLIC_KEY` simply has no
  updater. Keep it that way — it prevents a local debug build from accepting update
  payloads.

## What the nightly sync does

`.github/workflows/component-updates.yml`, at 02:17 daily:

1. Resolves the latest `pi` and `pi-web` releases; stops if neither moved.
2. Skips if a review PR for this upstream tag is already open.
3. **Classifies the incoming upstream changeset against the manifest, before merging** —
   after the merge commit exists, the incoming changeset can no longer be recovered
   with a plain diff.
4. Merges the upstream tag and updates the pi dependencies.
5. Gates on `npm test` (including `components/*.test.mjs`), `tsc --noEmit`, `npm run lint`,
   and a real standalone Next build.
6. **No overlap** → pushes to `main` and dispatches the signed release.
   **Overlap at blocked risk** → pushes `sync/pi-web-<tag>` and opens a PR with the
   boundary report. Merging that PR is what triggers the release.
7. On failure, files or comments on a `component-sync-failure` issue.

A merge conflict fails step 4 and nothing ships — that is the design.

## Reducing the cost

The gate's `autoPushPolicy.blockOnRisk` currently blocks on `high` and `medium`, which
means most upstream releases will require a reviewed PR. That is an accurate reflection
of the current drift, not a pessimistic setting. It loosens on its own as structural
drift is reverted to upstream and entries leave `driftedUpstreamFiles`.

Narrow `blockOnRisk` only when the drift is actually gone — never to quiet the gate.

## Commands

```
npm test        # the same gate CI runs: lib + scripts + components tests
npm run drift   # cosmetic vs structural drift, flags stale manifest risk levels
npm run lint    # eslint + branding check
```
