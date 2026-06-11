# TODOS

## ai-gen

### Pack-tarball smoke test in CI
**Priority:** P2
The exports-map test self-imports against the source tree, so it cannot catch
a `files`-allowlist omission breaking the published tarball. Once CI exists:
`npm pack` into a tmp dir, install the tarball, and import the package root
from outside the source tree. (Surfaced by the 0.5.0 red-team review,
2026-06-11.)

### Installed/npx runs write outputs into the package directory
**Priority:** P2
`out-dir.js` defaults `OUT_ROOT` to the package's own `out/` via
`import.meta.url`, so `npx altexo-ai-gen` writes into the npx cache copy (and a
`node_modules` install loses outputs on reinstall) unless `AI_GEN_OUT_ROOT` is
set — while the bin dispatcher comment claims cwd-relative outputs. Decide a
cwd default for installed mode (mirroring the `init` `.env` split). Also
validate `project:` *format* before the paid generation call — `makeOutDir`
runs post-generation in gen-image/gen-veo/gen-kling, so an invalid name burns
the spend first. (Surfaced by the 0.5.0 cross-model doc review, 2026-06-11.)

### Harden veo/kling/openai onto the library surface
**Priority:** P3
The video generators and `openai-image.js` stay CLI-first as of 0.5.0.
Bringing them onto the surface needs the same contract: per-call keys,
abort/timeout, error taxonomy — plus a rename/dispatch decision for
`openai-image.js`'s conflicting `generateImage` export.

## Completed
