# This is the Homebrew Cask for Clavis. It does NOT live here at runtime — it is
# the maintained source copy. Deploy it to the tap repo:
#
#   ziwangprincex/homebrew-clavis  →  Casks/clavis.rb
#
# Users then install with:
#   brew install --cask ziwangprincex/clavis/clavis
#
# Per release you MUST update `version` and `sha256` (see packaging/homebrew/README.md).
cask "clavis" do
  version "1.0.0"
  sha256 "REPLACE_WITH_DMG_SHA256" # shasum -a 256 Clavis_<version>_aarch64.dmg

  url "https://github.com/ziwangprincex/Clavis/releases/download/v#{version}/Clavis_#{version}_aarch64.dmg"
  name "Clavis"
  desc "Markdown / LaTeX / Typst editor with live preview"
  homepage "https://github.com/ziwangprincex/Clavis"

  # Only an Apple-Silicon (aarch64) DMG is published today. Drop this line and
  # add an Intel URL/sha256 branch if you start shipping an x86_64 build too.
  depends_on arch: :arm64
  depends_on macos: ">= :big_sur" # matches tauri.conf.json minimumSystemVersion 11.0

  # Clavis updates itself via the built-in Tauri updater, so tell Homebrew not
  # to treat in-app updates as an out-of-date cask.
  auto_updates true

  app "Clavis.app"

  zap trash: [
    "~/Library/Application Support/clavis",
    "~/Library/Caches/com.clavis.app",
    "~/Library/Preferences/com.clavis.app.plist",
    "~/Library/Saved Application State/com.clavis.app.savedState",
  ]

  caveats <<~EOS
    Clavis is ad-hoc signed but NOT notarized by Apple, so macOS may report it
    as "damaged". Clear the quarantine flag once:

      xattr -cr /Applications/Clavis.app
  EOS
end
