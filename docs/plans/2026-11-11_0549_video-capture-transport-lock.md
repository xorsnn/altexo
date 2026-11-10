# Video capture transport prerequisite

Source: https://github.com/xorsnn/rompix/issues/1779 and the owner's request to
record their own staging.rompix.com/app.rompix.com generations for offline tests.

Decision: expose a supported per-call HTTP transport for Kling video generation,
Character creation and video downloads, so a server-owned recorder can observe
and replay the same exchanges without global fetch interception or private hooks.

This delivers the upstream prerequisite only. Rompix still uses Kling3.0; no4.0
cutover, live recorder activation, publishing, paid probe, app reset or deployment
is included. The user merges. Full recording needs a subsequent published release
and owner-scoped app integration; do not claim this PR alone records anything.

## Discovery and touch-list

Discovery: `rg -n 'fetchImpl|_fetch|downloadToFile|GenerateVideoOptions|CreateElementOptions|saveVideo' packages/ai-gen/src packages/ai-gen/test`.

- `packages/ai-gen/src/kling.js`: public `fetch` option for generateVideo, preserving
  default global fetch and private `_fetch` compatibility; saveVideo accepts fourth
  optional options object with fetch. Reject invalid public transports before I/O.
- `packages/ai-gen/src/kling-elements.js`: same fetch option for createElement.
- `packages/ai-gen/src/download.js`: internal optional fetch transport with global
  default, preserving Veo callers. Do not change retries, timeouts or payloads.
- `packages/ai-gen/src/index.d.ts`: document the per-call transport and download options.
- `packages/ai-gen/test/kling-transport.test.js` (and existing contract tests only if
  needed): offline tests for record/replay including real Response.clone behavior,
  both provider stages, element flow, binary download, rejection before provider or
  local-file I/O, abort/error propagation and independence of concurrent calls.
- `packages/ai-gen/{README,CHANGELOG}.md`, `package.json` and root `package-lock.json`:
  add public API documentation and additive0.13.0 release metadata, preserve v3 aliases.
- This lock: challenge disposition and final verification evidence.

## Acceptance

| Observable result | Proof | No claim |
|---|---|---|
| Provided transport handles submit and every poll per call | offline captured exchanges replay through generateVideo/createElement | provider entitlement or live success |
| Download uses supplied transport and writes exact captured bytes | saveVideo offline binary round-trip in private scratch | file is visually high quality |
| Capture does not need private hooks or global fetch mutation | tests invoke only public fetch option; concurrent transports remain separate | complete rompix recorder exists |
| Existing callers/aliases/defaults/error and abort contracts survive | existing offline library suite plus focused invalid/abort tests | current video support becomes4.0 |
| Raw transport is explicitly sensitive | README explains authorization headers/input/URLs and sanitization before persistence | transport itself is a safe recording artifact |

## Exact verification recipe

Root `/home/xors/workspace/_WORKTREES/altexo/1779-video-capture-transport`.
Source `~/.config/dev-storage/env.sh` in commands. Private evidence/output beneath
`$DEV_TMP_ROOT/artifacts/2026-11-11_0549_video-capture-transport/`.

1. `npm ci --ignore-scripts` from root: fresh dependency resolution from lockfile.
2. `node --test packages/ai-gen/test/kling-transport.test.js`: proves public record/replay.
3. Syntax check every tracked JS under packages with `node --check`: prevents syntax errors.
4. `npm test` from root: existing offline package contracts stay green. No provider calls.
5. `npm pack --workspace @altexo/ai-gen --pack-destination <scratch>` and install the
   tarball in a private scratch package with scripts disabled; run an imported public
   generateVideo/createElement/saveVideo smoke using only fake transport and local
   fixtures. Detects missing pack files and shipped API mismatches.
6. In the scratch consumer install pinned TypeScript5.9.3 and @types/node24.10.0
   with scripts disabled. Compile a strict NodeNext consumer of all three public
   transport options using `tsc --noEmit --strict --module NodeNext --moduleResolution
   NodeNext --target ES2022`. Detects declaration/runtime surface disagreement.
7. Fetch main, inspect diff and version collision with open altexo PRs before push.

No app build/e2e/storage suite or rompix version bump applies to this upstream-only
prerequisite. No upstream CI, timeout, assertion or threshold relaxations authorized.

### Guideline updates

`packages/ai-gen/README.md`: supported transport, safe capture responsibility and
replay usage. No AGENTS.md/CLAUDE.md convention change identified.

## Challenge and results

Independent challenge: no implementation blockers. The challenger identified that
JavaScript pack smoke alone cannot prove shipped TypeScript declarations; accepted
and added the separate strict packed-consumer compilation above. Note retained:
public transport injection preserves normal polling delays, so replay alone does
not imply faster scheduling. Do not add public timing controls to this prerequisite;
document the limit and use test-runner clock controls if necessary in offline tests.

Source implementation may proceed within the touch-list. Verification results follow.


## Verification and delivery result

Implementation commit `12a73fdda4d60bdcb1ac89b72d1921e73f23d277` passed both
implementer and independent Mechanical verification. The following Mechanical
command/verdict/quoted-evidence table is preserved verbatim. All provider exchanges
were fake; no generation, element creation or billing call was made.

| Command | Verdict | Quoted evidence |
|---|---|---|
| `npm ci --ignore-scripts` | PASS; exit 0 | Fresh lockfile install completed; npm reported 1 moderate advisory. |
| `node --test packages/ai-gen/test/kling-transport.test.js` | PASS; exit 0 | “tests 7”; “pass 7”; “fail 0”; “skipped 0” |
| `node --check` on every tracked `packages/**/*.js` | PASS; exit 0 | “Checked 24 tracked JavaScript files; errors=0; exit=0” |
| `npm test` | PASS; exit 0 | “tests 118”; “pass 118”; “fail 0”; “skipped 0” |
| `npm pack --workspace @altexo/ai-gen --pack-destination <private-scratch>` | PASS; exit 0 | “version: 0.13.0”; “total files: 31” |
| `npm install --ignore-scripts --save-exact ../altexo-ai-gen-0.13.0.tgz typescript@5.9.3 @types/node@24.10.0` | PASS; exit 0 | “added 45 packages”; “found 0 vulnerabilities” |
| `node smoke.mjs` | PASS; exit 0 | “Packed public video/element/download transport smoke PASS” |
| `./node_modules/.bin/tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 consumer.ts` | PASS; exit 0 | “diagnostics=0”; “TypeScript 5.9.3; @types/node 24.10.0” |
| `git fetch origin main`; `git diff --check origin/main...HEAD`; `gh pr list --repo xorsnn/altexo --state open --json number,title,headRefName,url` | PASS; each exit 0 | Open PRs: “[]”; no version collision. |


Cleanup: independent scratch dependencies, tarball and generated media were removed
and their absence verified; no owned workers remain. Small evidence logs and task
worktree dependencies are retained. Fresh origin/main remains `b9db1be`; no open
upstream PR/version collision was found. Source inspection found no unresolved
issue. No existing validator, CI step, timeout, threshold, assertion or suppression
was modified; the seven added tests protect the new public transport contract.

Publication, owner-scoped rompix recording/persistence/export and activation on
staging/production remain subsequent work. Existing paid discovery authorization
was not consumed, and live4.0 proof/reset are not claimed. Ready for review at an
open upstream PR; the owner merges.
