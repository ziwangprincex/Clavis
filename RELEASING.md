# Releasing Clavis (with auto-update)

Clavis ships Tauri's built-in updater: an installed app checks GitHub Releases
for a newer **signed** build and can install it in-app (command palette →
"Check for Updates…", plus a quiet check at startup).

This doc is the release runbook. Steps 1–2 are one-time setup; steps 3+ repeat
per release.

## Current release preparation (2026-09-09)

The owner clarified "打包app啊 我要更新程序的": this is an authorized **formal
installer and in-app update**, not just a source push or updater-disabled trial.
Prepare **1.4.0** from published v1.3.2 with Chinese UI, full font controls and the
reviewed neutral PDF surround / translucent editor-selection repairs. Include all
associated source, tests and documentation. Notes: [v1.4.0.md](docs/releases/v1.4.0.md).

Authorization covers this release commit, a new v1.4.0 tag, GitHub draft/publication
and Homebrew distribution update. Do not move old tags, replace old packages,
rotate keys or disable the production updater. No Apple credentials/notarization.
The earlier local app-only trial ZIPs have no updater: their users need one manual
install of the formal DMG. Native Air visual acceptance and actual installed-app
upgrading remain unverified until tested on the device.

Require successful exact-tag CI and all three platform installers, signed updater
packages and the complete six-entry manifest before publication. Verify every
updater archive with the unchanged deployed public key. The existing workflow can
produce empty notes and mutable latest-download URLs: copy reviewed notes into
latest.json and pin its package URLs to this exact tag, preserving all signatures,
platform entries and package bytes. Reverify after uploading only the corrected
manifest. Record publication, public latest.json and Homebrew checks in HANDOFF.
Future work does not inherit this release authorization.

Local preparation (no commit required):

```bash
python3 -m unittest discover -s tools -p 'test_*.py'
python3 tools/check_release.py
python3 tools/check_handoff.py --working-tree
bash build-macos.sh --app-only --skip-install
```

The local script snapshots and restores Cargo files because Tauri 1 can rewrite
features/lock data when updater is disabled for a trial bundle. It does not
modify the production public key. Do not edit Cargo inputs concurrently.


## Prerequisites

- Rust toolchain + the Tauri CLI (`cargo install tauri-cli` or `npm --prefix web i`).
- Push access to `ziwangprincex/Clavis`.

## 1. Generate the updater signing key (ONE TIME)

The updater refuses unsigned updates, so you need a keypair. Generate it locally
and **never commit the private key**:

```bash
# from the repo root
npm --prefix web exec tauri signer generate -- -w "$HOME/.tauri/clavis.key"
# Windows PowerShell:
#   npm --prefix web exec tauri signer generate -- -w "$env:USERPROFILE\.tauri\clavis.key"
```

It prompts for a password and writes:
- `~/.tauri/clavis.key`     — private key (secret)
- `~/.tauri/clavis.key.pub` — public key

### Put the public key in the app

Copy the **entire contents** of `clavis.key.pub` into `tauri.conf.json` →
`tauri.updater.pubkey`, replacing the `REPLACE_WITH_CLAVIS_KEY_PUB_CONTENTS`
placeholder. Commit that change.

### Put the private key in GitHub Secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:
- `TAURI_PRIVATE_KEY`  = full contents of `~/.tauri/clavis.key`
- `TAURI_KEY_PASSWORD` = the password you chose

## 2. Confirm the endpoint

`tauri.conf.json` → `tauri.updater.endpoints` points at:

```
https://github.com/ziwangprincex/Clavis/releases/latest/download/latest.json
```

The release workflow attaches `latest.json` to each Release, so `/latest/` always
resolves to the newest published (non-draft) release.

## 3. Cut a release

### Recommended: guarded PowerShell preparation

Start from a clean `main` working tree:

```powershell
.\tools\release.ps1 1.0.2
```

The script refuses a dirty tree or non-`main` branch, updates the version in
`Cargo.toml`, `Cargo.lock`, and `tauri.conf.json`, validates that all three match,
and runs the frontend checks/build plus Rust tests. It deliberately does **not**
commit, tag, or push; review the diff and update `docs/HANDOFF.md` first, then run the
commands it prints.

### Manual equivalent

1. Set the same SemVer in `Cargo.toml`, the Clavis entry in `Cargo.lock`, and
   `tauri.conf.json` -> `package.version`.
2. Validate it:
   ```bash
   python tools/check_release.py --tag v1.0.2
   ```
3. Update `docs/HANDOFF.md`, commit the release preparation, then tag and push:
   ```bash
   git tag v1.0.2
   git push origin main
   git push origin v1.0.2
   ```
4. The **Release** workflow verifies that the tag matches all project versions
   and runs the reusable CI workflow on that exact commit (frontend checks/tests,
   production build, Rust checks/tests and release-guard tests). Only after both
   pass does it create one **draft** Release and build/upload Windows, macOS and
   Linux installers plus signed updater artifacts and `latest.json`. This gate
   does not replace manual native acceptance or permission to publish.
5. Review the draft Release and **publish** it. Only published, non-draft releases
   are visible through `/releases/latest/` and therefore to the in-app updater.

A normal push to `main` only runs CI; it does not create or update a Release.

## 4. How users get the update

- Installed apps run a silent check at startup and expose "Check for Updates…"
  in the command palette (Ctrl/Cmd+Shift+P).
- When a newer version is found, the app shows the version + a short summary and,
  on confirm, downloads → verifies signature → installs → relaunches.
- Keep `docs/releases/<tag>.md`, the GitHub release body and `latest.json` notes
  to a version heading and at most three short user-facing bullets (240 characters
  total). Put test counts, CI details and technical handoff material in HANDOFF,
  not the update prompt. Mention any critical migration warning within this budget.
- Older installed apps show the entire manifest notes in a non-scrolling native
  alert. Always check the actual `latest.json` notes before publication; shortening
  only the GitHub release page or local notes does not fix their update prompt.
  Updating already-published notes needs explicit remote authorization; preserve
  all versions, package URLs, signatures and installer bytes.

## Notes / limitations

- **No OS code signing yet.** The updater signs its own packages (required), but
  we do not do Apple notarization / Windows Authenticode. First-time installers
  may trigger a Gatekeeper / SmartScreen warning; auto-update itself is unaffected.
  Revisit if distributing widely.
- The updater ships **full-package** updates (Tauri v1 has no delta updates).
- `deb` is built for convenience but the Linux updater uses the **AppImage**.
- Keep the private key safe. If it's lost, existing installs can no longer verify
  updates signed with a new key — you'd have to ship a manual reinstall.

## Troubleshooting

### `Warn The updater secret key from TAURI_PRIVATE_KEY does not match the public key`

The private key used at build time (env var `TAURI_PRIVATE_KEY`, or a local
`~/.tauri/clavis.key`) is **not the mate** of the `tauri.updater.pubkey` currently
in `tauri.conf.json`. Updates signed by this build will be rejected at runtime.

This happens when the public key and signing secret are not a matching pair.
First restore the private key matching the public key deployed in existing apps,
or revert an accidental public-key change. **Do not regenerate or rotate keys as
routine troubleshooting**: installed apps trust their embedded key, so a new key
pair can break their update path. Rotation needs an explicit migration plan.

For an approved formal signing build, provide the existing matching key through
the environment (local app-only candidates do not need it):

```bash
export TAURI_PRIVATE_KEY="$(cat "$HOME/.tauri/clavis.key")"
export TAURI_KEY_PASSWORD="<your-password>"
```

Note: this warning only affects **auto-update signature verification**, not
whether the `.dmg` / `.app` itself runs.
