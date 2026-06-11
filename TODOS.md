# TODOS

## ai-gen

### Pack-tarball smoke test in CI
**Priority:** P2
The exports-map test self-imports against the source tree, so it cannot catch
a `files`-allowlist omission breaking the published tarball. Once CI exists:
`npm pack` into a tmp dir, install the tarball, and import the package root
from outside the source tree. (Surfaced by the 0.5.0 red-team review,
2026-06-11.)

### Harden veo/kling/openai onto the library surface
**Priority:** P3
The video generators and `openai-image.js` stay CLI-first as of 0.5.0.
Bringing them onto the surface needs the same contract: per-call keys,
abort/timeout, error taxonomy — plus a rename/dispatch decision for
`openai-image.js`'s conflicting `generateImage` export.

## Completed
