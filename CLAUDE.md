# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm test` — runs all unit tests (`node --test`) against `tests/*.test.js`. No build step; loads the plain-JS source files via `vm.createContext` (see Testing below).
- Run a single unit test file: `node --test tests/config-manager.test.js`
- `npx playwright test` — runs the browser specs (`extension.spec.js`, `screenshots.spec.js`), loading the unpacked extension into a real Chromium instance via a persistent context. Playwright is `headless: false` (see `playwright.config.js`) — a window will actually open.
- Run a single Playwright spec: `npx playwright test tests/extension.spec.js`, or a single test by name: `npx playwright test -g "injects command bar"`
- No lint/build/typecheck script is configured — this is unbundled Manifest V3 JS loaded directly by Chrome.
- To manually load the extension: `chrome://extensions/` → enable Developer mode → Load unpacked → select this directory.

## Architecture

This is a Manifest V3 Chrome extension with no bundler — every JS file is loaded as-is. Read `manifest.json` first: it fixes both the content-script load order and the extension's permission surface.

**Content script load order matters.** `prow-plugin-map.js` → `config-manager.js` → `content.js`, all injected on `https://github.com/*` at `document_idle`. Each attaches itself to a shared global namespace (`window.GHBCP.CommandToPlugin`, `window.GHBCP.ConfigManager`, etc.) rather than using ES modules — later files depend on globals the earlier ones set up.

**Two-process split**: `content.js` (runs in the GitHub page, does all DOM injection/button rendering/SPA re-injection) never makes network calls directly. It talks to `background.js` (the service worker) via `chrome.runtime.sendMessage({action: '...'})` / `chrome.runtime.onMessage`; `background.js` is the only place that calls `api.github.com`, `raw.githubusercontent.com`, or the GCS rehearsal-job listing endpoint. When adding a new remote lookup, add a `msg.action` case in `background.js`'s listener, not a `fetch()` in `content.js`.

**SPA re-injection**: GitHub is a Turbo/PJAX app, so `content.js` re-runs its injection logic on `turbo:load`, `pjax:end`, `popstate`, `hashchange`, and via a `MutationObserver` watching for the Checks section / dialogs being re-rendered — all debounced through one `debouncedInject()`.

**Prow/CI domain logic** lives mostly in `content.js` and `background.js` together: check rows are scraped from GitHub's Checks section, classified as Prow-owned vs. GitHub-Actions-native (only the latter get a Rerun button — Prow ones get `/test`/`/override`), and pj-rehearse rehearsal checks (`ci/rehearse/<org>/<repo>/<branch>/<shortname>`) have their real job name resolved by fetching the target repo's presubmit YAML and reproducing Prow's own shortname algorithm (`parseRehearsalCheckContext`, `computePresubmitContextShortName`, `findRehearsalJobMatch` in `content.js`) — never guessed from the check name alone.

**Config system**: `config-manager.js` (`GHBCP.ConfigManager`) is CRUD + glob repo-pattern matching over the `BotProfile`/`BotCommand`/`DynamicCommandRule` schema stored in `chrome.storage.sync`; `config-export.json` is the canonical schema example and the default-profile seed data. The optional GitHub PAT (for one-click Actions reruns) is deliberately kept out of that schema — it lives in its own `chrome.storage.local` key so it's device-scoped and excluded from Export/Import.

**Testing without a browser**: the unit tests don't `require()` the source files as CommonJS modules (they aren't — these are browser globals scripts with no `module.exports`). Instead each test file `fs.readFileSync`s the source and runs it inside a `vm.createContext` with hand-stubbed `chrome`/`document`/`window` globals. When a function needs to be unit-tested, prefer keeping it a pure, dependency-free top-level function (like the `parse*`/`compute*` helpers in `content.js`) so it stays trivial to exercise this way.

**Debugging the extension live**: when using chrome-devtools MCP to drive a browser, that's for debugging the extension's own injected UI/behavior on a GitHub PR page — not for investigating CI/Prow test failures on the repos the PR pages happen to belong to.

## Backlog task history

`backlog/tasks/` holds this repo's implementation history as Backlog.md tasks (e.g. content.js splitting, dedup cleanups, rehearsal-picker fixes) — worth checking before assuming a piece of functionality hasn't been considered yet.

<!-- BACKLOG.MD MCP GUIDELINES START -->

<CRITICAL_INSTRUCTION>

## BACKLOG WORKFLOW INSTRUCTIONS

This project uses Backlog.md MCP for all task and project management activities.

**CRITICAL GUIDANCE**

- If your client supports MCP resources, read `backlog://workflow/overview` to understand when and how to use Backlog for this project.
- If your client only supports tools or the above request fails, call `backlog.get_backlog_instructions()` to load the tool-oriented overview. Use the `instruction` selector when you need `task-creation`, `task-execution`, or `task-finalization`.

- **First time working here?** Read the overview resource IMMEDIATELY to learn the workflow
- **Already familiar?** You should have the overview cached ("## Backlog.md Overview (MCP)")
- **When to read it**: BEFORE creating tasks, or when you're unsure whether to track work

These guides cover:
- Decision framework for when to create tasks
- Search-first workflow to avoid duplicates
- Links to detailed guides for task creation, execution, and finalization
- MCP tools reference

You MUST read the overview resource to understand the complete workflow. The information is NOT summarized here.

</CRITICAL_INSTRUCTION>

<!-- BACKLOG.MD MCP GUIDELINES END -->
