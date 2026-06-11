// Single source of truth for model IDs and pricing.
//
// The registry is DATA, not code: it lives in ../models.default.json so it can
// be overridden without editing source (the point of milestone 03 — keeping the
// later OSS extraction a clean lift). Update that JSON when Google or Kling
// version a model.
//
// Override per-model without touching the repo by pointing AI_GEN_MODELS_CONFIG
// at a JSON file: a model present in the override REPLACES the default entry
// wholesale (per-model shallow replace); unmentioned models keep their defaults;
// new aliases are added. A bad override path throws — a misconfigured env var is
// operator error and should surface immediately rather than silently misprice.
//
// readFileSync + JSON.parse (not a JSON import attribute) keeps `MODELS` a
// populated, synchronous object at module-eval time — the contract every
// consumer relies on. External consumers import MODELS from the package root
// (the exports map blocks deep src/* imports as of 0.5.0).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, isAbsolute } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const loadJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const base = loadJson(resolve(here, '../models.default.json'));

let overrides = {};
const overridePath = process.env.AI_GEN_MODELS_CONFIG;
if (overridePath) {
  const resolved = isAbsolute(overridePath)
    ? overridePath
    : resolve(process.cwd(), overridePath);
  overrides = loadJson(resolved);
}

// The `_comment` key in models.default.json documents the file; strip it so it
// never looks like a model alias. (Override files needn't carry it.)
delete base._comment;

export const MODELS = { ...base, ...overrides };

export function priceImage(model, resolution = '2K') {
  const m = MODELS[model];
  if (!m) return null;
  if (m.pricing.perImage != null) return m.pricing.perImage;
  return m.pricing[resolution] ?? null;
}

export function priceVideo(model, seconds) {
  const m = MODELS[model];
  if (!m) return null;
  if (m.pricing.perSecond != null) return m.pricing.perSecond * seconds;
  return m.pricing[seconds] ?? null;
}

// Single source of truth for "what does this batch cost" — used by the
// library return shape (generateImage's costEstimate) and the CLI manifests
// alike, so the rounding and resolution handling can never drift apart.
export function estimateImageCost(model, count, resolution = '2K') {
  const unit = priceImage(model, resolution) ?? 0;
  return Number((unit * count).toFixed(3));
}
