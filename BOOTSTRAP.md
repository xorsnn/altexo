# Bootstrap `@altexo/ai-gen` in one prompt

Paste this whole file to an AI coding agent (Claude Code, Cursor, etc.) and it
will get you from nothing to one generated image. Or just follow the numbered
commands yourself in a terminal — every step is a plain shell command.

**Goal:** install the toolkit, set up an API key, and generate one test image
(Nano Banana Flash, ~$0.04).

---

## If you are an AI agent

Do these steps in order. **Never echo the user's API keys** into the transcript,
a file you print, or a commit. Make exactly **one** paid generation (the smoke
test). If any step fails, stop and report the command, the error, and your best
guess at the fix — do not retry blindly or invent keys.

## Steps

1. **Check Node ≥ 20.3.** Run `node --version`. If it's older or missing, tell the
   user to install Node 20.3+ (https://nodejs.org) and stop.

2. **Pick an install path.**
   - *Quick trial (one image):* nothing to install — use `npx @altexo/ai-gen`.
   - *Repeated work:* clone the repo so prompts and `out/` live in one place:
     ```bash
     git clone https://github.com/xorsnn/altexo.git
     cd altexo && npm install
     cd packages/ai-gen
     ```

3. **Get a Gemini API key.** Ask the user for their `GEMINI_API_KEY`
   (free tier works) — https://aistudio.google.com/apikey. Kling keys are
   optional and only needed for Kling video later.

4. **Configure keys.** Run the guided setup — it writes a gitignored `.env` and
   never prints the values back:
   ```bash
   npx @altexo/ai-gen init          # or, from a clone: node bin/altexo-ai-gen.js init
   ```
   Answer the Gemini prompt; skip Kling unless the user has those keys; decline
   the smoke-test prompt here (the next step runs it explicitly).

5. **Smoke test — one ~$0.04 image.**
   ```bash
   npx @altexo/ai-gen smoke         # or, from a clone: npm run image -- prompts/_smoketest.flash.yaml
   ```
   This generates a single brand-neutral test image.

6. **Report the result.** Print the output folder it wrote
   (`out/_smoketest/<timestamp>_smoketest-flash_nano-banana-flash/`) and confirm
   a `.png` and a `manifest.json` are inside. Done.

---

## What you get

- `altexo-ai-gen init` — guided key setup → `.env`
- `altexo-ai-gen smoke` — one cheap test image
- `altexo-ai-gen image|veo|kling|pipeline <prompt.yaml>` — the generators
- `altexo-ai-gen --help` — full command list

Outputs are deterministic folders with a `manifest.json` reproducibility receipt.
See [`packages/ai-gen/README.md`](packages/ai-gen/README.md) for prompt-file
fields, model notes, and pricing.
