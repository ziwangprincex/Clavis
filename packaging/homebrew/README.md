# Homebrew tap for Clavis

Clavis is distributed as a macOS **Cask** (it's a GUI `.app` shipped in a DMG).
This directory holds the maintained source of that cask; the live copy lives in
the separate tap repository:

> https://github.com/ziwangprincex/homebrew-clavis

## One-time: set up the tap repo

The tap repo must be named `homebrew-clavis` (the `homebrew-` prefix is what lets
`brew tap ziwangprincex/clavis` find it). Layout:

```
homebrew-clavis/
└── Casks/
    └── clavis.rb        ← copy of packaging/homebrew/Casks/clavis.rb
```

```bash
git clone https://github.com/ziwangprincex/homebrew-clavis.git
cd homebrew-clavis
mkdir -p Casks
cp /path/to/Clavis/packaging/homebrew/Casks/clavis.rb Casks/clavis.rb
# edit version + sha256 (see below), then:
git add Casks/clavis.rb && git commit -m "clavis 1.0.0" && git push
```

## Install (end users)

```bash
brew install --cask ziwangprincex/clavis/clavis
# or:
brew tap ziwangprincex/clavis
brew install --cask clavis
```

Not notarized → if macOS blocks first launch, `brew install --cask --no-quarantine clavis`
(or right-click the app → Open).

## Per release: bump the cask

After a GitHub release publishes `Clavis_<version>_aarch64.dmg`:

```bash
VERSION=1.0.1
curl -L -o /tmp/clavis.dmg \
  "https://github.com/ziwangprincex/Clavis/releases/download/v${VERSION}/Clavis_${VERSION}_aarch64.dmg"
shasum -a 256 /tmp/clavis.dmg   # copy the hash into sha256
```

Update `version` and `sha256` in `Casks/clavis.rb`, commit, push. Then verify:

```bash
brew audit --cask --online clavis
brew style clavis
```

## Automatic updates on release

`.github/workflows/update-homebrew.yml` keeps the tap in sync automatically:
when you **publish** a GitHub Release (the `Release` workflow creates it as a
draft; you review and publish), it downloads the published DMG, computes its
sha256, regenerates `Casks/clavis.rb`, and pushes it to `homebrew-clavis`.

One-time setup — add a repo secret so the workflow can push to the tap:

1. Create a **fine-grained Personal Access Token** (GitHub → Settings →
   Developer settings → Fine-grained tokens): Repository access = only
   `ziwangprincex/homebrew-clavis`, Permissions → **Contents: Read and write**.
2. In the **Clavis** repo → Settings → Secrets and variables → Actions → New
   repository secret: name `HOMEBREW_TAP_TOKEN`, value = that token.

After that, the manual `version`/`sha256` edits below are only needed if you ever
publish a build outside the workflow. The workflow always writes the canonical
cask (so it also self-heals things like a wrong `desc`).

