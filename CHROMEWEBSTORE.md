# Chrome Web Store Listing — GitHub Bot Command Palette

> Last Updated: 2026-10-16

## Store Listing

**Extension Name** [REQUIRED]
GitHub Bot Command Palette

> Trademark risk: "GitHub" in the name may be flagged. If the review team
> objects, rename to "Bot Command Palette for GitHub" (and update manifest.json).

**Short Description** [REQUIRED] (≤132 chars)
Adds one-click buttons for Prow/CI slash commands like /lgtm, /retest and /override to GitHub pull request pages.

**Detailed Description** [REQUIRED]
```
Adds one-click buttons for CI and bot slash commands to GitHub pull request pages, so you stop retyping /lgtm, /approve, /retest and /override.

Features
• Command bar above the PR comment box with color-coded buttons for /lgtm, /approve, /hold, /retest and more, plus keyboard shortcuts.
• Test and Override pickers: search every CI job on the PR, select several, and fire them in one comment.
• Buttons on each failing check row in the Checks section.
• Rehearsal checks (pj-rehearse) are matched to the real job name from the target repository's own CI configuration instead of guessing.
• Checks that are plain GitHub Actions jobs get a Rerun link, or a one-click Rerun button if you add your own GitHub token.
• Bot profiles per repository pattern (for example openshift/*), with per-repo overrides, custom commands, and Import/Export of your settings.

How to use
1. Install the extension and open any pull request on github.com.
2. Click a button in the command bar, or open Test… / Override… to pick jobs.
3. Click the toolbar icon, then Open Settings, to add or edit bot profiles.

Privacy
Everything runs in your browser. The extension has no server and collects no data. Your settings sync through your Chrome profile. The optional GitHub token stays on your device and is only sent to api.github.com when you click Rerun or Verify Token.

Support
Report issues or request features at https://github.com/kaovilai/github-bot-command-palette/issues
```

**Category** [REQUIRED]
Developer Tools

**Single Purpose** [REQUIRED]
Adds one-click CI/bot slash-command buttons to GitHub pull request pages.

**Primary Language** [REQUIRED]
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | icons/icon128.png |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready | store-assets/screenshots/02-command-bar-in-context.png |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready | store-assets/screenshots/01-command-bar.png |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ✅ Ready | store-assets/screenshots/14-override-dropdown-jobs.png |
| Screenshot 4 | 1280×800 | ✅ Ready | store-assets/screenshots/15-test-dropdown-jobs.png |
| Screenshot 5 | 1280×800 | ✅ Ready | store-assets/screenshots/12-checks-section.png |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

### Screenshot Notes
Resized from the 1400×870 files in `screenshots/` (≈0.6% aspect change). Regenerate
after UI changes: `sips -z 800 1280 screenshots/<name>.png --out store-assets/screenshots/<name>.png`.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| storage | permissions | Saves the user's bot profiles, repo patterns and custom commands (sync), and the optional GitHub token (local only). |
| https://github.com/* | host_permissions | Content script injects the command bar and per-check buttons on GitHub pull request pages; also lets the popup read the current tab's URL to show which repo/PR is active. |
| https://api.github.com/* | host_permissions | Looks up PR details and, only when the user clicks Rerun/Verify Token, calls the GitHub Actions rerun API with the user's own token. |
| https://raw.githubusercontent.com/* | host_permissions | Fetches the target repo's public Prow plugin config and presubmit job YAML to learn which slash commands and job names are valid. |
| https://gcs.ci.openshift.org/* | host_permissions | Reads public Prow rehearsal-job listings and CI analysis artifacts to resolve rehearsal check names. |
| https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/* | host_permissions | Alternate public listing endpoint for the same rehearsal job data. |
| https://storage.googleapis.com/* | host_permissions | Reads public CI result objects from Google Cloud Storage buckets referenced by rehearsal checks. |

`activeTab` was removed from the manifest: the `github.com` host permission already
exposes the active tab's URL on GitHub pages, so it was unused.

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes (declare conservatively; nothing leaves the user's device except to the services below)

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | | |
| Health info | No | No | | |
| Financial info | No | No | | |
| Authentication info | Yes (optional user-supplied GitHub token) | Only to api.github.com on user click | One-click Actions rerun | No (sent to GitHub, the service it authenticates to) |
| Personal communications | No | No | | |
| Location | No | No | | |
| Web history | No | No | | |
| User activity | No | No | | |
| Website content | Read locally from GitHub PR pages | No (only repo name/PR number in lookups) | Place buttons, list CI jobs | No |

`chrome.storage.sync` settings are synced by Chrome to the user's Google account (disclose as off-device transmission to Google, not to the developer).

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
https://github.com/kaovilai/github-bot-command-palette/blob/main/PRIVACY.md
(live only after this PR merges to `main` — verify before submitting)

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name** [REQUIRED]
TODO — Tiger Kaovilai (verified publisher/trader status per dashboard)

**Contact Email** [REQUIRED]
TODO — public email; must be verified in the developer dashboard

**Support URL / Email** [RECOMMENDED]
https://github.com/kaovilai/github-bot-command-palette/issues

**Homepage URL** [RECOMMENDED]
https://github.com/kaovilai/github-bot-command-palette

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.0 | 2026-10-16 | Initial store submission | Draft |

## Publishing Steps

1. `scripts/package-extension.sh` → `github-bot-command-palette-v1.0.0.zip`.
2. Register at https://chrome.google.com/webstore/devconsole (one-time US$5 fee) and verify contact email.
3. New item → upload ZIP.
4. Paste Store Listing, Single Purpose, Permissions and Privacy sections from above; upload icon + screenshots; set Privacy Policy URL.
5. Submit for review.

## Review Notes

### Known Issues / Limitations
- Broad-ish host permissions (6 hosts) — each justified above; reviewers may ask for a demo. Reviewers need a GitHub PR on a repo with Prow comments to see the buttons; offer e.g. https://github.com/openshift/oadp-operator/pulls.
- Name contains "GitHub" trademark.

### Rejection History
| Date | Reason | Fix Applied | Resubmitted |
|------|--------|-------------|-------------|
