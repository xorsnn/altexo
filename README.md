# altexo

A personal toolbelt of small, focused CLI tools for creative/media production.
Each tool is an independent, installable package under the `@altexo/*` scope; they
share this monorepo for config and release. MIT licensed.

## Packages

| Package | Status | What it does |
| ------- | ------ | ------------ |
| [`@altexo/ai-gen`](packages/ai-gen) | available | Direct-API CLI + library for AI image/video generation (Nano Banana Pro, Veo 3.1, Kling 3). Cheaper, reproducible alternative to aggregators for repeated templates. |
| `@altexo/blender` | planned | Scripts for authoring scenes and rendering video with Blender headless. |
| `@altexo/skills` | planned | Reusable agent skills / slash-commands for the media workflow. |

## Install a single tool

```bash
npm install @altexo/ai-gen
# or run without installing
npx @altexo/ai-gen --help
```

## Work on the whole repo

```bash
git clone https://github.com/xorsnn/altexo.git
cd altexo
npm install          # installs all workspaces
npm test             # runs each package's tests
```

This is an npm-workspaces monorepo (`packages/*`). Node >= 20.

## License

MIT © Sergei Grigorev
