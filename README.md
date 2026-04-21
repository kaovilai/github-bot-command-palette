# GitHub Bot Command Palette

Chrome extension that injects contextual action buttons for CI/bot slash commands on GitHub PR pages.

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `github-bot-command-palette` directory
5. Navigate to any GitHub PR page — command buttons appear above the comment box

## Features

- **Slash command buttons** — one-click `/lgtm`, `/approve`, `/retest`, `/hold`, etc.
- **Profile system** — configure commands per bot system (Prow, Mergify, Changesets, etc.)
- **Repo pattern matching** — glob patterns like `openshift/*` to scope profiles
- **Inline check buttons** — retest buttons next to failed CI checks
- **Dynamic commands** — auto-generate buttons from failed check names (e.g., `/pj-rehearse <job-name>`)
- **Keyboard shortcuts** — Alt+L for LGTM, Alt+A for Approve, Alt+R for Retest
- **GitHub theme support** — matches light/dark mode automatically
- **SPA-aware** — works with GitHub's Turbo/PJAX navigation

## Built-in Profiles

| Profile | Match Pattern | Commands |
|---------|--------------|----------|
| Tide/Prow — Universal | `*` (all repos) | `/lgtm`, `/approve`, `/hold`, `/retest`, `/cc` |
| Prow — OpenShift Release | `openshift/release` | `/pj-rehearse ack`, `/pj-rehearse <test>` |
| Mergify | `*` (disabled by default) | `/mergify requeue`, `/mergify refresh` |
| Changesets Bot | `*` (disabled by default) | `/changeset <type>` |

## Adding a New Bot Profile

1. Click the extension icon → **Open Settings**
2. Scroll to **Bot Profiles** → click **+ Add Profile**
3. Fill in:
   - **Name** — display name
   - **Repo Patterns** — one glob pattern per line (e.g., `myorg/*`)
   - **Commands** — add global commands (always visible) and check commands (next to failed CI)
4. Click **Save**

## Per-Repo Overrides

In Settings → **Repo Overrides**, you can:
- Add extra profiles for a specific repo
- Disable profiles for a specific repo
- Add one-off commands for a specific repo

## Import / Export

- **Export**: Settings → Export Config (JSON) — downloads `ghbcp-config.json`
- **Import**: Settings → Import Config — upload a previously exported JSON file
- **Reset**: Settings → Reset to Defaults — restores built-in profiles

## Architecture

```
manifest.json          — Chrome Manifest V3 config
config-manager.js      — Configuration CRUD, storage, glob matching
content.js             — Main injection: DOM manipulation, button rendering, SPA listeners
styles.css             — GitHub-themed styles (light/dark, responsive)
settings.html/js       — Full settings page (profiles, commands, import/export)
popup.html/js          — Toolbar popup (current repo, matched profiles)
icons/                 — Extension icons (16/48/128px)
config-export.json     — Sample config with all default profiles
```

## Configuration Schema

See `config-export.json` for the full schema. Key types:

- **BotProfile** — name, repo patterns, global/check/dynamic commands
- **BotCommand** — label, command text, style, input support, keyboard shortcut
- **DynamicCommandRule** — JS expression evaluated with check context (testName, checkName)

## Security

- No `eval()` — dynamic commands use `new Function()` with scoped variables only
- All user input sanitized before DOM insertion
- No network requests from content script — all config from `chrome.storage.sync`
- Runs only on `https://github.com/*`
