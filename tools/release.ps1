[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidatePattern('^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$')]
    [string]$Version,

    [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $RepoRoot

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is required' }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw 'python is required' }

$currentBranch = (git branch --show-current).Trim()
if ($currentBranch -ne 'main') { throw "Release preparation must run on main; current branch is '$currentBranch'." }
if (git status --porcelain) { throw 'Working tree must be clean before preparing a release.' }

$tag = "v$Version"
if (git rev-parse --verify --quiet "refs/tags/$tag") { throw "Tag $tag already exists locally." }

python tools/set_version.py $Version
if ($LASTEXITCODE -ne 0) { throw 'Could not update release versions.' }

python tools/check_release.py --tag $tag
if ($LASTEXITCODE -ne 0) { throw 'Release metadata validation failed.' }

if (-not $SkipChecks) {
    npm --prefix web run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Frontend typecheck failed.' }
    npm --prefix web test
    if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed.' }
    npm --prefix web run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    cargo test
    if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed.' }
}

Write-Host "Update HANDOFF.md with the release preparation before committing." -ForegroundColor Yellow
Write-Host "Then run:" -ForegroundColor Cyan
Write-Host "  git add Cargo.toml Cargo.lock tauri.conf.json HANDOFF.md"
Write-Host "  git commit -m \"Release $tag\""
Write-Host "  git tag $tag"


Write-Host "After review, push with:" -ForegroundColor Cyan
Write-Host "  git push origin main"
Write-Host "  git push origin $tag"
Write-Host "The Release workflow will create a draft; publish it manually after checking all assets."
