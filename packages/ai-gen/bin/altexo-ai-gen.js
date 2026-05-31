#!/usr/bin/env node
// altexo-ai-gen — CLI entry for @altexo/ai-gen.
// Thin dispatcher: the generators stay in scripts/*.js (run as-is); this adds
// `init` (guided key setup), `smoke` (one cheap test image), and a portable
// `npx`-able front door so the package works installed *or* from a clone.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

const HERE = dirname(fileURLToPath(import.meta.url)); // .../packages/ai-gen/bin
const PKG_ROOT = resolve(HERE, '..'); // .../packages/ai-gen
const PKG = JSON.parse(readFileSync(resolve(PKG_ROOT, 'package.json'), 'utf8'));

// Installed (node_modules) vs. working from a clone. Decides where `.env` lives:
// a clone keeps it package-local (src/env.js reads it); an install writes it to
// the caller's cwd (writing inside node_modules would vanish on reinstall).
const INSTALLED = PKG_ROOT.split(/[\\/]/).includes('node_modules');
const ENV_TARGET = INSTALLED
  ? resolve(process.cwd(), '.env')
  : resolve(PKG_ROOT, '.env');

const SCRIPTS = {
  image: resolve(PKG_ROOT, 'scripts/gen-image.js'),
  veo: resolve(PKG_ROOT, 'scripts/gen-veo.js'),
  kling: resolve(PKG_ROOT, 'scripts/gen-kling.js'),
  pipeline: resolve(PKG_ROOT, 'scripts/gen-pipeline.js'),
};
const SMOKE_PROMPT = resolve(PKG_ROOT, 'prompts/_smoketest.flash.yaml');

const HELP = `altexo-ai-gen ${PKG.version} — direct-API AI image/video generation

Usage:
  altexo-ai-gen <command> [args]

Commands:
  init                 Guided API-key setup — writes a .env, optional smoke test
  smoke                Generate one cheap test image (Nano Banana Flash, ~$0.04)
  image <prompt.yaml>  Generate image(s)        (Nano Banana)
  veo <prompt.yaml>    Generate video           (Veo 3.1)
  kling <prompt.yaml>  Generate video           (Kling 3)
  pipeline <p.yaml>    Image -> video pipeline
  --help, -h           Show this help
  --version, -v        Show version

Keys: GEMINI_API_KEY (required), KLING_ACCESS_KEY + KLING_SECRET_KEY (optional).
Run \`altexo-ai-gen init\` to set them up, or see .env.example.

First run:
  npx @altexo/ai-gen init      # enter your Gemini key
  npx @altexo/ai-gen smoke     # one ~$0.04 image to confirm it works
`;

main(process.argv.slice(2)).catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

async function main(argv) {
  const cmd = argv[0];

  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write(`${PKG.version}\n`);
    return;
  }
  if (cmd === 'init') {
    await runInit(argv.slice(1));
    return;
  }
  if (cmd === 'smoke') {
    runScript(smokeArgs());
    return;
  }
  if (cmd in SCRIPTS) {
    const rest = argv.slice(1);
    if (rest.length === 0) {
      console.error(`Usage: altexo-ai-gen ${cmd} <prompt.yaml>`);
      process.exit(1);
    }
    runScript([SCRIPTS[cmd], ...rest]);
    return;
  }

  console.error(`Unknown command: ${cmd}\n`);
  process.stdout.write(HELP);
  process.exit(1);
}

function smokeArgs() {
  if (!existsSync(SMOKE_PROMPT)) {
    console.error(`Smoke-test prompt not found: ${SMOKE_PROMPT}`);
    process.exit(1);
  }
  return [SCRIPTS.image, SMOKE_PROMPT];
}

// Run one of the bundled generator scripts as a child process. We pull in a
// cwd-local .env first so keys written by `init` in installed mode are visible;
// the child inherits process.env. Real shell env always wins (dotenv never
// overrides already-set vars). The child runs with the caller's cwd so prompt
// paths, references, and the out/ folder resolve where the user expects.
function runScript(args) {
  const cwdEnv = resolve(process.cwd(), '.env');
  if (existsSync(cwdEnv)) loadEnv({ path: cwdEnv });
  const res = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  if (res.error) {
    console.error(res.error.message);
    process.exit(1);
  }
  process.exit(res.status ?? 0);
}

async function runInit(flags) {
  const forceSmoke = flags.includes('--smoke') || flags.includes('--yes') || flags.includes('-y');
  const noSmoke = flags.includes('--no-smoke');
  const force = flags.includes('--force');

  console.log('altexo-ai-gen init — set up your API keys.\n');
  console.log(`This writes ${ENV_TARGET}\n(${INSTALLED ? 'installed mode: caller cwd' : 'clone mode: package-local'}).\n`);

  if (existsSync(ENV_TARGET) && !force) {
    const ans = await ask(`A .env already exists at ${ENV_TARGET}. Overwrite? (y/N) `);
    if (!isYes(ans)) {
      console.log('Kept the existing .env. Nothing changed.');
      return;
    }
  }

  const gemini = await askHidden('Gemini API key (https://aistudio.google.com/apikey): ');
  if (!gemini) {
    console.error('A Gemini API key is required. Aborting — nothing written.');
    process.exit(1);
  }

  let klingAccess = '';
  let klingSecret = '';
  const wantKling = await ask('Add Kling keys now? (y/N) ');
  if (isYes(wantKling)) {
    klingAccess = await askHidden('Kling access key (https://app.klingai.com/global/dev/account): ');
    klingSecret = await askHidden('Kling secret key: ');
  }

  writeFileSync(ENV_TARGET, renderEnv({ gemini, klingAccess, klingSecret }));
  // Make the keys available to a smoke test in this same process, regardless of
  // clone vs installed mode (don't print the values).
  process.env.GEMINI_API_KEY = gemini;
  if (klingAccess) process.env.KLING_ACCESS_KEY = klingAccess;
  if (klingSecret) process.env.KLING_SECRET_KEY = klingSecret;
  console.log(`\nWrote ${ENV_TARGET} (keys not echoed).`);

  let doSmoke = forceSmoke;
  if (!forceSmoke && !noSmoke) {
    const ans = await ask('\nRun a smoke test now? Makes one ~$0.04 image call. (y/N) ');
    doSmoke = isYes(ans);
  }
  if (doSmoke) {
    console.log('\nRunning smoke test (Nano Banana Flash)...\n');
    runScript(smokeArgs()); // exits with the child status
  } else {
    console.log('\nDone. Next: altexo-ai-gen smoke   (one ~$0.04 image to confirm).');
  }
}

function renderEnv({ gemini, klingAccess, klingSecret }) {
  const lines = [
    '# Written by `altexo-ai-gen init`. Values in your shell environment override this file.',
    '',
    '# Google Gemini — Nano Banana Pro (image) + Veo 3.1 (video).',
    `GEMINI_API_KEY=${gemini}`,
    '',
    '# Kling official API (api.klingai.com) — Kling 3 video.',
    `KLING_ACCESS_KEY=${klingAccess}`,
    `KLING_SECRET_KEY=${klingSecret}`,
    '',
  ];
  return lines.join('\n');
}

function isYes(s) {
  return /^y(es)?$/i.test((s || '').trim());
}

function ask(query) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) =>
    rl.question(query, (a) => {
      rl.close();
      res((a || '').trim());
    })
  );
}

// Like ask(), but doesn't echo what's typed (for secrets). The prompt itself is
// written before muting; on submit we emit a newline so the terminal advances.
function askHidden(query) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let muted = false;
    rl._writeToOutput = (str) => {
      if (!muted) rl.output.write(str);
    };
    rl.question(query, (a) => {
      rl.output.write('\n');
      rl.close();
      resolve((a || '').trim());
    });
    muted = true;
  });
}
