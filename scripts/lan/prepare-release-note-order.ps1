[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
Push-Location $projectRoot
try {
    $shallow = [string](& git rev-parse --is-shallow-repository)
    if ($LASTEXITCODE -ne 0 -or $shallow.Trim() -ne "false") {
        throw "Release numbering requires a full Git clone. Run git fetch --unshallow if needed."
    }
    $revision = [string](& git rev-parse HEAD)
    if ($LASTEXITCODE -ne 0 -or $revision.Trim() -notmatch '^[a-f0-9]{40}$') { throw "Cannot read Git revision." }
    $branch = [string](& git branch --show-current)
    if ($LASTEXITCODE -ne 0) { throw "Cannot read Git branch." }
    $reference = "HEAD"
    if ($branch.Trim() -and $branch.Trim() -ne "main") {
        $main = $null
        foreach ($candidate in @("refs/remotes/origin/main", "refs/heads/main")) {
            & git rev-parse --verify --quiet $candidate 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { $main = $candidate; break }
        }
        if (-not $main) { throw "Release numbering requires main. Run git fetch origin main." }
        $reference = [string](& git merge-base HEAD $main)
        if ($LASTEXITCODE -ne 0) { throw "Cannot find the shared main history." }
        $reference = $reference.Trim()
    }
    $paths = @(& git log --first-parent --reverse --diff-filter=A --name-only --format= $reference -- `
        apps/desktop/release-notes/pending apps/desktop/release-notes/released)
    if ($LASTEXITCODE -ne 0) { throw "Cannot read release note history." }
    $fileNames = [System.Collections.Generic.List[string]]::new()
    foreach ($path in $paths) {
        $name = [System.IO.Path]::GetFileName($path)
        if ($name -match '^\d{8}-[a-z0-9-]+\.json$' -and -not $fileNames.Contains($name)) { $fileNames.Add($name) }
    }
    # Unmerged/working-tree notes are provisional, just as in a native Vite build.
    [string[]]$currentNames = @(Get-ChildItem -LiteralPath "apps/desktop/release-notes/pending", "apps/desktop/release-notes/released" `
        -Filter "*.json" -File -Recurse | ForEach-Object { $_.Name })
    [Array]::Sort($currentNames, [StringComparer]::Ordinal)
    foreach ($name in $currentNames) {
        if (-not $fileNames.Contains($name)) { $fileNames.Add($name) }
    }
    $metadata = @{ format = 1; revision = $revision.Trim(); fileNames = @($fileNames.ToArray()) } | ConvertTo-Json -Depth 3
    $destination = Join-Path $projectRoot "apps\desktop\release-notes\order.generated.json"
    [System.IO.File]::WriteAllText($destination, $metadata, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Prepared release numbering metadata for $($revision.Trim()). No credentials or Git directory are copied."
}
finally { Pop-Location }
