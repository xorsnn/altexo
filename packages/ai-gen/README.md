# @altexo/ai-gen

Direct-API scripts for AI image and video generation. Calls **Nano Banana Pro**
(image), **OpenAI gpt-image-1** (image), **Veo 3.1** (video), and **Kling 3**
(video) over their native APIs and writes deterministic outputs into
`out/<project>/YYYY-MM-DD_HHMM_<slug>_<model>/` with a `manifest.json`
reproducibility receipt.

It's a cheaper, reproducible alternative to canvas-style aggregators when you run
the **same template many times** — every call is scripted from a small YAML file,
so a shot is re-runnable and diff-able instead of hand-clicked.

## Install

```bash
npm install @altexo/ai-gen
```

Or work from a clone:

```bash
git clone https://github.com/xorsnn/altexo.git
cd altexo && npm install
cd packages/ai-gen
cp .env.example .env     # fill in your keys
```

Node >= 20.

## Quickstart

```bash
# image (Nano Banana)
npm run image -- prompts/example.image.yaml

# image (OpenAI gpt-image-1) — same YAML, different engine
npm run openai -- prompts/example.image.yaml

# video (Veo)
npm run veo -- prompts/example.veo.yaml

# video (Kling, official API)
npm run kling -- prompts/example.kling.yaml

# image -> video pipeline
npm run pipeline -- prompts/example.pipeline.yaml
```

Outputs land in `out/<project>/YYYY-MM-DD_HHMM_<slug>_<modelAlias>/`. The project
subfolder groups every asset for one job side-by-side; the model alias in the
suffix keeps comparisons (e.g. `..._myshot_kling-pro` vs `..._myshot_veo-fast`)
scannable at a glance. Every prompt YAML must declare a `project:` field — the
scripts refuse to run without it (see [`prompts/_schema.md`](prompts/_schema.md)).
`out/` is gitignored.

## Configuration

The toolkit runs from config — nothing is hardcoded to a particular machine or repo.

**API keys.** `src/env.js` loads `.env` from the package root if present; values
already in your shell environment take precedence. Required:

- `GEMINI_API_KEY` — Nano Banana + Veo — <https://aistudio.google.com/apikey>
- `KLING_ACCESS_KEY` + `KLING_SECRET_KEY` — Kling — <https://app.klingai.com/global/dev/account>
- `OPENAI_API_KEY` — gpt-image-1 (optional) — <https://platform.openai.com/api-keys>

See [`.env.example`](.env.example).

**Model registry + pricing** live in [`models.default.json`](models.default.json)
(data, not code; `src/models.js` reads it). To change model IDs or prices without
editing source, set `AI_GEN_MODELS_CONFIG` to a JSON file path (absolute, or
relative to cwd). It layers **per-model shallow replace**: a model present in your
override replaces the default entry wholesale, models you don't mention keep their
defaults, and new aliases are added. A bad path throws — a misconfigured override
surfaces immediately rather than silently mispricing.

```jsonc
// my-models.json — bump Kling Pro's price and swap its model id
{ "kling-pro": { "vendor": "kling", "id": "kling-v3.1", "mode": "pro",
                 "kind": "video", "pricing": { "5": 0.50, "10": 1.00 } } }
```

```bash
AI_GEN_MODELS_CONFIG=./my-models.json npm run kling -- prompts/example.kling.yaml
```

**Output root.** Defaults to `./out`. Set `AI_GEN_OUT_ROOT` (absolute, or relative
to cwd) to write elsewhere.

## Prompt files

YAML — see [`prompts/_schema.md`](prompts/_schema.md) for the full field reference.
The `prompts/example.*.yaml` files are working samples for each generator.

## Cost reference (per single generation, USD)

Native API list prices, from `models.default.json`:

| Model               | Output        | Native API |
| ------------------- | ------------- | ---------: |
| Nano Banana Pro 1K  | image         | $0.134     |
| Nano Banana Pro 2K  | image         | $0.134     |
| Nano Banana Pro 4K  | image         | $0.24      |
| Nano Banana Flash   | image         | $0.039     |
| gpt-image-1 (high)  | image (2:3)   | ~$0.25     |
| Veo 3.1 (8s)        | video + audio | $3.20      |
| Veo 3.1 Fast (8s)   | video + audio | $1.20      |
| Kling 3 Master (5s) | video         | $0.70      |
| Kling 3 Pro (5s)    | video         | $0.42      |
| Kling 3 Pro + audio | video + audio | $0.84      |
| Kling 3 Std (5s)    | video         | $0.21      |

Aggregators that resell these models typically mark them up ~1.5–3× (and often
gate them behind a subscription), which is the whole reason this calls the native
APIs directly. Each run's `manifest.json` records the cost estimate. Prices
approximate as of mid-2026 — verify against the providers' current pricing.

## Model notes

### Nano Banana Pro — `src/nano-banana.js`
- Model ID `gemini-3-pro-image-preview` (use `nano-banana-flash` →
  `gemini-2.5-flash-image` for cheaper drafts).
- SDK `@google/genai`, `ai.models.generateContent({...})` with
  `responseModalities: ['IMAGE']`.
- Aspect ratios: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9.
- Up to 14 reference images via `references:` — how you keep style/character
  consistent across a series.
- Outputs carry an invisible SynthID watermark.

### Veo 3.1 — `src/veo.js`
- Model IDs `veo-3.1-generate-preview` or `veo-3.1-fast-generate-preview`
  (~3× cheaper).
- Same `GEMINI_API_KEY`. SDK `ai.models.generateVideos({...})` returns a
  long-running op; the wrapper polls every 10s and downloads the MP4 (Veo URIs
  need the API key as a `?key=` param to download).
- Length 4/6/8s. Native audio on by default (`audio: false` to disable).
- `image_input:` animates a still — the natural pairing with Nano Banana.
- A single video typically takes 1–4 minutes.

### Kling 3 — `src/kling.js`
- Kuaishou's official international API at `https://api.klingai.com`.
- Auth: JWT (HS256) signed from `KLING_ACCESS_KEY` + `KLING_SECRET_KEY`; the
  wrapper mints a fresh 30-min token per call via `jsonwebtoken`.
- Model IDs are best-guess for Kling 3 — if you get `invalid model_name`, open the
  [Kling dev console](https://app.klingai.com/global/dev), trigger a working
  request, and copy the exact `model_name` from the Network tab into your
  `AI_GEN_MODELS_CONFIG` override.
- Length 5/10s. `image_input:` is base64-encoded into the request (no upload step).
- Native audio on **kling-pro**: set `audio: true` for synced SFX / ambient — the
  wrapper sends the official Kling `sound: "on"` field. Pro tier only, single start
  frame only (not with `image_tail`), billed at the model's `audioMultiplier` (~2×).
  Other tiers are silent — pair with a music bed in your editor.
- Rate limits are stricter than Google's; keep calls sequential.

### OpenAI gpt-image-1 — `src/openai-image.js`
- A second image engine, handy for **A/B**: feed the *same* prompt YAML to
  `npm run openai` and `npm run image` and compare gpt-image-1 against Nano Banana.
- Auth: `OPENAI_API_KEY`. Dependency-free raw `fetch` against the Images API;
  mirrors the `nano-banana.js` shape so the same save / out-dir plumbing is reused.
- Sizes are fixed: `1024x1536` (2:3), `1024x1024` (1:1), `1536x1024` (3:2). **There
  is no true 9:16** — a `9:16` input maps to `1024x1536` and the manifest records the
  actual pixel `size`. `quality:` is `low` / `medium` / `high` (default `high`).

### Pipeline — `scripts/gen-pipeline.js`
Chains Nano Banana → Veo or Kling in one call, so you get a high-fidelity hero
frame instead of letting the video model hallucinate the first frame from text.
See [`prompts/example.pipeline.yaml`](prompts/example.pipeline.yaml).

## Reproducibility

`out/<run>/manifest.json` captures the project, prompt, model ID, params, timing,
and cost estimate — everything needed to re-run a generation. Commit a manifest
alongside an asset if you want a permanent record of how it was made.

## License

MIT © Sergei Grigorev
