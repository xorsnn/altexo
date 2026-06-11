# Prompt YAML schema

A prompt file is a small YAML doc consumed by the `gen-*.js` CLIs. Same shape
across all three models; some fields are model-specific.

## Single-model prompt (image, Veo, or Kling)

```yaml
project: my-project                 # REQUIRED — see "Project field" below
slug: hero-shot                     # required — used in the output dir name
model: nano-banana                  # nano-banana | nano-banana-flash | veo | veo-fast | kling-master | kling-pro | kling-std
prompt: |
  Multi-line prompt goes here.
  Use the `|` block scalar so newlines are preserved.

# Common
aspect: "9:16"                     # 1:1, 9:16, 16:9, 4:5, 3:2, etc. (see model docs)
count: 1                            # number of takes/images per call (paid per output)

# Image-only
references:                         # optional, up to 14 image paths (relative to cwd)
  - refs/hero-ref.png
resolution: "2K"                   # 1K | 2K | 4K — used for cost reporting only
quality: high                       # gpt-image-1 only (run via gen-openai.js): low | medium | high. Nano Banana ignores it. Note: gpt-image-1 has no true 9:16 — a 9:16 input maps to 1024x1536 (2:3).

# Video-only
seconds: 8                          # Veo: 4|6|8 — Kling v3: 3-15 (gen-kling default 5)
image_input: refs/hero.png         # animate this still (first frame) instead of pure text-to-video
image_tail: refs/end.png           # optional — condition the LAST frame too. Requires image_input. Use for seamless loops (set image_tail == image_input) or for hard A->B transitions. Supported on Kling Pro (image_tail) and Veo 3.1 (lastFrame). Cost is the same as a regular image-conditioned generation.
audio: true                         # native audio. Veo: on by default (free). Kling: OFF by default — set true for synced SFX/ambient (sends the official `sound:"on"`). Needs a PRO model + single start frame (no image_tail): kling-pro. ~2x cost.
resolution: "1080p"                # Veo only — 1080p (1080x1920 at 9:16) is default. REQUIRES seconds: 8. Use "720p" for 4s/6s clips.
negative_prompt: blur, distort     # Kling only

# Multi-shot (Kling v3 only) — split one clip into up to 6 prompted segments.
# The SUM of the shot `seconds` must be a valid Kling length (3-15); when present,
# top-level `seconds` is ignored. shot_type: customize (honor the list) | intelligence (auto).
shot_type: customize
multi_shot:
  - prompt: "Wide establishing shot, slow push-in."
    seconds: 3
  - prompt: "Cut to close-up, action peaks."
    seconds: 4

# Reference subjects / elements (Kling v3 only) — character/object consistency.
# Reuse pre-created ids, or create inline from images (max 3 elements). Reference them
# in the prompt as <<<element_1>>>, <<<element_2>>>, … (positional). Make a reusable id:
#   node scripts/gen-kling-element.js <name> <frontal.png> <refer1.png> [refer2 ...]
# (an image element needs a frontal + 1-3 refer images.)
element_ids: [12345]                 # pre-created element ids (optional)
elements:                            # OR create inline (frontal first, then 1-3 refer images)
  - name: hero-bot                   # element_name ≤ 20 chars
    description: "short ≤100-char subject description"
    images:
      - refs/hero-front.png
      - refs/hero-side.png
```

## Project field (required)

Every YAML must declare a top-level `project:` field. Generations land in
`out/<project>/<timestamp>_<slug>_<modelAlias>/` so it's easy to find every asset
for a given job alongside its siblings.

Naming convention:

- Pick a stable kebab-case or snake_case name reflecting the job, e.g.
  `landing-page-hero`, `product-shoot`, `intro-reel`. Keep it stable even if the
  surrounding work gets renamed — historical paths in manifests stay valid.
- For style exploration / one-offs, use `_examples` or a date-prefixed bucket like
  `2026-05-13_style-test`. The underscore prefix signals "not a real project."

Validation: project name must match `/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/`. The scripts
refuse to start if `project:` is missing. An *invalid* name is rejected when the
output dir is created — for `pipeline` that's before generation, but for
image/Veo/Kling it's after the paid call, so get the name right up front.

## Pipeline prompt (image -> video chain)

```yaml
project: my-project                 # REQUIRED — see "Project field" above
slug: giant-scale-reel
aspect: "9:16"                     # default for both stages

image:
  model: nano-banana
  prompt: |
    Wide cinematic establishing shot of a single brick figure standing
    beside a brick tower, dawn light, hyper-real macro detail.
  references:
    - refs/hero-ref.png

video:
  model: veo                        # or veo-fast, kling-master, kling-pro
  seconds: 8
  prompt: |
    Slow camera push-in toward the figure as morning fog drifts past.
    Subtle animation of cloth and dust. Cinematic colour grade.
```

## Field reference — model defaults

| Field        | Default          | Notes                                      |
| ------------ | ---------------- | ------------------------------------------ |
| `model`      | per script       | image=`nano-banana`, veo=`veo`, kling=`kling-master` |
| `aspect`     | `9:16` (all generators) | Override only for non-vertical output  |
| `count`      | 1                | Each output costs separately               |
| `seconds`    | 8 (Veo), 5 (Kling) | See model docs for valid values          |
| `audio`      | true (Veo), false (Kling) | Veo on (free); Kling opt-in on kling-pro (~2×) |
| `resolution` | `1080p`          | Veo only — `720p` also valid               |
| `quality`    | `high`           | gpt-image-1 only (`gen-openai.js`)         |
| `references` | none             | Up to 14 (Nano Banana Pro)                 |

## Output

Every run produces `out/<project>/YYYY-MM-DD_HHMM_<slug>_<modelAlias>/` containing:

- The generated assets (`img-01.png`, `video-01.mp4`, etc.)
- `manifest.json` capturing the project, prompt, model ID, params, timing, and cost estimate
- For pipelines, the hero frame is named `hero-01.png`

All runs for the same project sit side-by-side in their project subfolder, sorted
chronologically by timestamp prefix. The `out/` folder is gitignored.
