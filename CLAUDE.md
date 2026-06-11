# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Repo overview

npm-workspaces monorepo (`packages/*`), Node >= 20.3. `npm test` runs every
package's test suite. The one shipped package is
[`@altexo/ai-gen`](packages/ai-gen/README.md) — a direct-API CLI + embeddable
library for AI image/video generation; release notes in
[`packages/ai-gen/CHANGELOG.md`](packages/ai-gen/CHANGELOG.md). Getting-started
walkthrough: [`BOOTSTRAP.md`](BOOTSTRAP.md). Deferred work: [`TODOS.md`](TODOS.md).

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
