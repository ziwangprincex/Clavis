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

### Recommended: guarded PowerShell preparation

Start from a clean `main` working tree:

```powershell
.\tools\release.ps1 1.0.2
```

The script refuses a dirty tree or non-`main` branch, updates the version in
`Cargo.toml`, `Cargo.lock`, and `tauri.conf.json`, validates that all three match,
and runs the frontend checks/build plus Rust tests. It deliberately does **not**
commit, tag, or push; review the diff and update `HANDOFF.md` first, then run the
commands it prints.

### Manual equivalent

1. Set the same SemVer in `Cargo.toml`, the Clavis entry in `Cargo.lock`, and
   `tauri.conf.json` -> `package.version`.
2. Validate it:
   ```bash
   python tools/check_release.py --tag v1.0.2
   ```
3. Update `HANDOFF.md`, commit the release preparation, then tag and push:
   ```bash
   git tag v1.0.2
   git push origin main
   git push origin v1.0.2
   ```
4. The **Release** workflow first verifies that the tag matches all project
   versions. It then builds Windows, macOS, and Linux, signs updater artifacts,
   and creates one **draft** Release with the installers and `latest.json`.
5. Review the draft Release and **publish** it. Only published, non-draft releases
   are visible through `/releases/latest/` and therefore to the in-app updater.

A normal push to `main` only runs CI; it does not create or update a Release.

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

## Troubleshooting

### `Warn The updater secret key from TAURI_PRIVATE_KEY does not match the public key`

The private key used at build time (env var `TAURI_PRIVATE_KEY`, or a local
`~/.tauri/clavis.key`) is **not the mate** of the `tauri.updater.pubkey` currently
in `tauri.conf.json`. Updates signed by this build will be rejected at runtime.

This happens when `pubkey` is rotated but the signing machine / GitHub Secret
still holds the old private key (or vice-versa). The public and private key are a
**pair** — you cannot fix it by editing one; regenerate and set both together:

```bash
npm --prefix web exec tauri signer generate -- -w "$HOME/.tauri/clavis.key"
```

Then paste the new `clavis.key.pub` contents into `tauri.conf.json → tauri.updater.pubkey`
(the whole line, no trailing characters — a stray `%` from a terminal copy will
corrupt it), and update the `TAURI_PRIVATE_KEY` / `TAURI_KEY_PASSWORD` GitHub
Secrets from the new `clavis.key`. Local builds read the key from the env var:

```bash
export TAURI_PRIVATE_KEY="$(cat "$HOME/.tauri/clavis.key")"
export TAURI_KEY_PASSWORD="<your-password>"
```

Note: this warning only affects **auto-update signature verification**, not
whether the `.dmg` / `.app` itself runs.
