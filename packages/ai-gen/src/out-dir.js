import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Default output root is the package's own out/ dir; override with AI_GEN_OUT_ROOT
// (absolute, or relative to cwd) for portability. Unset → identical to before.
const OUT_ROOT = process.env.AI_GEN_OUT_ROOT
  ? resolve(process.env.AI_GEN_OUT_ROOT)
  : resolve(here, '../out');

const PROJECT_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

export async function makeOutDir(project, slug, modelTag = '') {
  if (!project || typeof project !== 'string') {
    throw new Error(
      'makeOutDir: missing project name. Every prompt YAML must declare a top-level `project:` field. ' +
        'See tools/ai-gen/prompts/_schema.md.'
    );
  }
  if (!PROJECT_RE.test(project)) {
    throw new Error(
      `makeOutDir: invalid project name "${project}". ` +
        'Must match /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/ (kebab-case, snake_case, or YYYYMMDD-prefixed slug).'
    );
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const suffix = modelTag ? `_${modelTag}` : '';
  const dirName = `${y}-${m}-${d}_${hh}${mm}_${slug}${suffix}`;
  const path = resolve(OUT_ROOT, project, dirName);
  await mkdir(path, { recursive: true });
  return path;
}
