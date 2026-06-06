# Changelog

All notable changes to `@altexo/ai-gen` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and this package adheres to
[Semantic Versioning](https://semver.org/).

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
