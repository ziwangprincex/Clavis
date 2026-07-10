# Releasing Clavis (with auto-update)

Clavis ships Tauri's built-in updater: an installed app checks GitHub Releases
for a newer **signed** build and can install it in-app (command palette →
"Check for Updates…", plus a quiet check at startup).

This doc is the release runbook. Steps 1–2 are one-time setup; steps 3+ repeat
per release.

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

1. Bump the version in **`tauri.conf.json` → `package.version`** (e.g. `1.0.1`).
   The updater compares this against `latest.json`, so every release must bump it.
2. Commit the bump.
3. Tag and push:
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```
4. The **Release** workflow (`.github/workflows/release.yml`) builds Windows,
   macOS, and Linux, signs the updater artifacts, and creates a **draft** Release
   with the installers + `latest.json`.
5. Review the draft Release on GitHub and **publish** it. Only published (non-draft)
   releases are seen by `/latest/`.

## 4. How users get the update

- Installed apps run a silent check at startup and expose "Check for Updates…"
  in the command palette (Ctrl/Cmd+Shift+P).
- When a newer version is found, the app shows the version + release notes and,
  on confirm, downloads → verifies signature → installs → relaunches.

## Notes / limitations

- **No OS code signing yet.** The updater signs its own packages (required), but
  we do not do Apple notarization / Windows Authenticode. First-time installers
  may trigger a Gatekeeper / SmartScreen warning; auto-update itself is unaffected.
  Revisit if distributing widely.
- The updater ships **full-package** updates (Tauri v1 has no delta updates).
- `deb` is built for convenience but the Linux updater uses the **AppImage**.
- Keep the private key safe. If it's lost, existing installs can no longer verify
  updates signed with a new key — you'd have to ship a manual reinstall.
