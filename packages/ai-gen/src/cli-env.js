// CLI entry side-effect module. MUST be the FIRST import in every
// scripts/*.js: ESM evaluates imports in declaration order, so this module
// loads the package-local .env BEFORE env-reading modules evaluate
// (models.js reads AI_GEN_MODELS_CONFIG, out-dir.js reads AI_GEN_OUT_ROOT,
// kling.js reads KLING_BASE_URL — all at import time). A plain
// loadLocalEnv() call in the script body would run after all of them.
// Library consumers never import this — the library surface stays
// side-effect-free.
import { loadLocalEnv } from './env.js';

loadLocalEnv();
