# Changelog

All notable changes to `@altexo/ai-gen` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and this package adheres to
[Semantic Versioning](https://semver.org/).

## [0.5.0] - 2026-06-11

Library hardening: the package is now safe to embed in a long-lived server
(previously CLI-only semantics could kill the host process).

### Added

- **Stable library surface.** `package.json` gains `main`, `types`, and an
  `exports` map (`.` → `src/index.js` + `src/index.d.ts`); import
  `generateImage`, `saveImages`, `extractImages`, `MODELS`, `priceImage`,
  `priceVideo`, `estimateImageCost`, and the error classes from the package
  root. Deep `src/*` imports are no longer part of the contract. Importing is
  side-effect-free (no `.env` load — CLI entry points load it via the
  `src/cli-env.js` first-import, which calls the new `loadLocalEnv()` before
  env-reading modules evaluate). Off the surface until hardened: Veo, Kling,
  and the OpenAI image generator.
- **TypeScript declarations** (`src/index.d.ts`) — the option/return shapes
  and the literal error-code union are compile-time checked for embedders.
- **Per-call `apiKey`** on `generateImage` — falls back to `GEMINI_API_KEY`.
  An explicit empty/non-string `apiKey` throws `MissingKeyError` before any
  I/O instead of slipping past the env fallback into the SDK.
- **Abort + timeout.** `generateImage({ signal, timeoutMs })` — caller's
  `AbortSignal` is honored, and a default 120s bound (cleared the moment the
  call settles) stops a hung request from pinning the caller. Aborts/timeouts
  surface unwrapped (`err.name === 'AbortError'/'TimeoutError'`); the library
  recovers the distinction from its own signals because `@google/genai` wraps
  abort signals and drops their reasons.
- **Structured error taxonomy** (`src/errors.js`): `AiGenError` with stable
  `code` — `missing-key`, `invalid-input` (unknown model, unreadable/bad
  reference, bad count — deterministic caller errors), `safety-block` (model
  returned zero images), `rate-limit` (429), `network` (transport/5xx),
  `unknown` fallback. `classifyError()` maps raw SDK/fetch failures onto it
  and structurally recognizes taxonomy errors from a second module copy
  (linked + published coexisting).
- Offline contract test suite (`test/library-contract.test.js`): throw-not-exit
  regression, per-call key, return shape, taxonomy mapping, abort/timeout
  recovery through an SDK-faithful fake, reference handling, CLI exit, input
  validation, exports-map self-import.

### Changed

- **`requireEnv` throws `MissingKeyError` instead of `console.error` +
  `process.exit(1)`** — the regression that motivated this release: an embedded
  missing/rotated key must not take down the host server. CLI scripts now exit
  non-zero via the uncaught throw (message first, then stack).
- **`generateImage` returns the stable shape
  `{ images: [{ mimeType, data }], modelId, costEstimate }`** — `raw` (the
  full provider payload) is no longer returned; `costEstimate` comes from the
  shared `estimateImageCost()` helper (also used by the CLI manifest, so the
  two can't drift). Zero images now throws `SafetyBlockError`; the provider
  may legitimately return fewer images than requested — that is a success and
  cost reflects the actual count.
- The Gemini backend is pinned (`vertexai: false`) so ambient
  `GOOGLE_GENAI_USE_VERTEXAI` in a host environment cannot reroute calls.
- Provider HTTP statuses route onto the taxonomy: 401/403 → `missing-key`
  (a revoked key must not look retryable), 400 → `invalid-input`, 5xx →
  `network`.
- All caller input is validated before the key is resolved and before any
  I/O — a bad model alias on an unconfigured host reports `invalid-input`,
  not `missing-key`. Validation now also covers `timeoutMs` (NaN previously
  disabled the hang guard silently; negative fired instantly), non-AbortSignal
  `signal` values, and video-model aliases passed to `generateImage`.
- Reference images are read in parallel, bounded by the same abort/timeout as
  the provider call, and failures surface as `invalid-input` taxonomy errors
  (previously a raw `ENOENT` escaped the contract). Unknown model aliases
  throw `invalid-input` instead of a `TypeError`.
- `saveImages` creates `outDir` if missing, writes in parallel with `wx`
  (a reused `outDir` fails loudly instead of silently overwriting a sibling
  generation), settles every write before returning or throwing, derives
  extensions through the mime allowlist (provider-controlled `mimeType` no
  longer lands raw in filenames), and rejects path-traversing prefixes.
- CLI scripts validate the model alias before use (previously a raw
  `TypeError` preempted the library's error).
- `engines.node` raised to `>=20.3` (`AbortSignal.any`).

## [0.4.0] - 2026-06-07

### Added

- **Kling v3 multi-shot.** `generateVideo({ multiShot, shotType })` splits one clip into up
  to 6 prompted segments (`multi_shot` / `shot_type` / `multi_prompt[{index,prompt,duration}]`
  on `image2video`/`text2video`); the per-shot seconds sum to the clip length (3–15). YAML:
  `multi_shot: [{ prompt, seconds }]` + `shot_type: customize|intelligence`. Verified on a
  real 3-shot render.
- **Kling v3 reference subjects (elements).** `createElement()` (new `src/kling-elements.js`,
  the async `advanced-custom-elements` API) builds a reusable element from a frontal + 1–3
  reference images; `generateVideo({ elementIds })` passes `element_list` and you reference
  them in the prompt as `<<<element_1>>>`, … (max 3). YAML: `elements: [{name, description,
  images}]` (inline create) or `element_ids: [...]`; new `scripts/gen-kling-element.js`
  (`npm run element` / `altexo-ai-gen element <name> <imgs>`). Verified on a real render that
  held a building's identity across a 10s crane.
- `KLING_BASE_URL` env override (the international host moved to `api-singapore.klingai.com`;
  `api.klingai.com` still resolves) and a shared `submitAndPoll()` task/poll helper.

## [0.3.2] - 2026-06-06

### Fixed

- **Kling v3 clip length corrected to 3–15s.** 0.3.1 capped Kling at 5/10s, which is
  the Kling 2.x rule; Kling 3.0 (`kling-v3`, launched 2026-02-04) generates an integer
  range of **3–15 seconds**. The `kling.js` duration guard is now **data-driven** — it
  reads each model's `durations` array from `models.default.json` instead of a hardcoded
  `[5,10]`. `kling-pro` / `kling-std` carry `durations` 3..15; `kling-master` stays 5/10
  and is flagged unverified (the official v3 map shows no master tier).
- **Kling pricing switched to per-second** (pro `$0.084/s`, std `$0.042/s`, master
  `$0.14/s`), derived from the prior linear 5/10s points, so any 3–15s clip prices
  correctly instead of resolving to `$0`. Verify against the live Kling 3.0 rate.

## [0.3.1] - 2026-06-06

### Fixed

- **Kling clip-length validation.** `generateVideo()` now rejects any Kling
  `duration` other than 5 or 10 seconds with a clear error, thrown synchronously
  before any token/network work (Kling renders only those two lengths). Previously
  an out-of-range duration was forwarded to the Kling API, which rejected it, and
  priced to `$0` because the pricing table is keyed to `5`/`10`.

## [0.3.0] - 2026-06-06

### Added

- **Native Kling audio** on `kling-pro`. Set `audio: true` in the prompt YAML (or
  pass `audio` to `generateVideo()`) for synced SFX / ambient — the wrapper sends
  the official Kling `sound: "on"` field (not the `enable_audio` boolean used by
  third-party wrappers). Pro tier only, single start frame only (not available with
  `image_tail`), billed at the model's new `audioMultiplier` (2×).
- **OpenAI gpt-image-1 image engine** — `src/openai-image.js` + `scripts/gen-openai.js`
  (`npm run openai`, or `altexo-ai-gen openai <prompt.yaml>`). Dependency-free raw
  `fetch` against the OpenAI Images API; mirrors the Nano Banana shape so the *same*
  prompt YAML feeds both engines for a clean A/B. Registered in `models.default.json`.
- `OPENAI_API_KEY` wiring: optional prompt in `altexo-ai-gen init` and an entry in
  `.env.example`.

### Notes

- gpt-image-1 has **no true 9:16** — its nearest vertical is `1024x1536` (2:3). A
  `9:16` input maps to that size and the manifest records the actual pixel `size`.
- gpt-image-1 pricing in the registry (`~$0.25`/image at `quality: high`) is
  quality/size-dependent — verify against OpenAI's current rate.

## [0.2.1] - 2026-05-31

### Added

- `npx`-able CLI (`bin/altexo-ai-gen.js`): `init` (guided key setup), `smoke` (one
  ~$0.04 test image), and `image|veo|kling|pipeline` wrappers, plus `--help` /
  `--version`.

### Fixed

- `init` now buffers stdin by line so it works with piped input (small piped inputs
  no longer drop the 2nd/3rd answers).

## [0.1.0] - 2026-05-31

### Added

- Initial public extraction of the direct-API toolkit: Nano Banana Pro (image),
  Veo 3.1 (video), and Kling 3 (video) over their native APIs, with an overridable
  model registry (`AI_GEN_MODELS_CONFIG`), parametrized output root
  (`AI_GEN_OUT_ROOT`), and `manifest.json` reproducibility receipts.
