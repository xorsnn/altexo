# Changelog

All notable changes to `@altexo/ai-gen` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and this package adheres to
[Semantic Versioning](https://semver.org/).

## [0.5.0] - 2026-06-11

Library hardening: the package is now safe to embed in a long-lived server
(previously CLI-only semantics could kill the host process).

### Added

- **Stable library surface.** `package.json` gains `main` + `exports`
  (`.` → `src/index.js`); import `generateImage`, `saveImages`, `extractImages`,
  `MODELS`, `priceImage`, `priceVideo`, and the error classes from the package
  root. Deep `src/*` imports are no longer part of the contract. Video
  generators (Veo, Kling) stay CLI-first, off the surface until hardened.
- **Per-call `apiKey`** on `generateImage` — falls back to `GEMINI_API_KEY`.
  Unblocks BYO-key embedding without mutating `process.env`.
- **Abort + timeout.** `generateImage({ signal, timeoutMs })` — caller's
  `AbortSignal` is honored, and a default 120s bound (`AbortSignal.timeout` +
  SDK `httpOptions.timeout`) stops a hung request from pinning the caller.
  Aborts/timeouts surface unwrapped (`err.name === 'AbortError'/'TimeoutError'`).
- **Structured error taxonomy** (`src/errors.js`): `AiGenError` with stable
  `code` — `missing-key`, `safety-block` (model returned zero images),
  `rate-limit` (429), `network` (transport/5xx), `unknown` fallback.
  `classifyError()` maps raw SDK/fetch failures onto it.
- Offline contract test suite (`test/library-contract.test.js`): throw-not-exit
  regression, per-call key, return shape, taxonomy mapping, abort passthrough,
  exports-map self-import.

### Changed

- **`requireEnv` throws `MissingKeyError` instead of `console.error` +
  `process.exit(1)`** — the regression that motivated this release: an embedded
  missing/rotated key must not take down the host server. CLI scripts now exit
  non-zero via the uncaught throw (message first, then stack).
- **`generateImage` returns the stable shape
  `{ images: [{ mimeType, data }], modelId, costEstimate }`** — `raw` (the
  full provider payload) is no longer returned; `costEstimate` is USD at the
  default 2K rate × image count. Zero images now throws `SafetyBlockError`
  instead of a bare `Error`.
- An unknown model alias throws a descriptive `AiGenError` instead of a
  `TypeError` on property access.

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
