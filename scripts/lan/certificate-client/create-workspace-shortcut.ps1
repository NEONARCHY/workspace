[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$IconFile,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{64}$')]
    [string]$ExpectedIconSha256,

    [Parameter(Mandatory = $true)]
    [string]$WorkspaceUrl,

    [string]$ShortcutPath,

    [string]$IconInstallDirectory
)

$ErrorActionPreference = "Stop"
$iconSource = (Resolve-Path -LiteralPath $IconFile).Path
if ([System.IO.Path]::GetExtension($iconSource) -ine ".ico") {
    throw "The shortcut icon must be a Windows .ico file."
}
if ((Get-FileHash -LiteralPath $iconSource -Algorithm SHA256).Hash -ne $ExpectedIconSha256) {
    throw "The shortcut icon does not match the verified package."
}

$uri = $null
if (-not [System.Uri]::TryCreate($WorkspaceUrl, [System.UriKind]::Absolute, [ref]$uri) -or
    $uri.Scheme -ne "https" -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
    throw "WorkspaceUrl must be an HTTPS origin without credentials, query or fragment."
}

if (-not $ShortcutPath) {
    $desktop = [Environment]::GetFolderPath("DesktopDirectory")
    if (-not $desktop) { throw "The current user's desktop could not be found." }
    $ShortcutPath = Join-Path $desktop "Yuksalish Workspace.lnk"
}
if (-not $IconInstallDirectory) {
    $localAppData = [Environment]::GetFolderPath("LocalApplicationData")
    if (-not $localAppData) { throw "Local application data could not be found." }
    $IconInstallDirectory = Join-Path $localAppData "Yuksalish Workspace"
}
$shortcutPath = [System.IO.Path]::GetFullPath($ShortcutPath)
if ([System.IO.Path]::GetExtension($shortcutPath) -ine ".lnk") {
    throw "ShortcutPath must end in .lnk."
}
$shortcutFolder = Split-Path -Parent $shortcutPath
if (-not (Test-Path -LiteralPath $shortcutFolder -PathType Container)) {
    throw "The shortcut destination does not exist: $shortcutFolder"
}

$iconDirectory = [System.IO.Path]::GetFullPath($IconInstallDirectory)
New-Item -ItemType Directory -Path $iconDirectory -Force | Out-Null
$installedIcon = Join-Path $iconDirectory "Yuksalish-Workspace.ico"
if ($iconSource -ne $installedIcon) {
    Copy-Item -LiteralPath $iconSource -Destination $installedIcon -Force
}
if ((Get-FileHash -LiteralPath $installedIcon -Algorithm SHA256).Hash -ne $ExpectedIconSha256) {
    throw "The installed shortcut icon could not be verified."
}

# Explorer opens the URL in the user's default browser. WScript.Shell silently saves an
# unusable .lnk if TargetPath is set directly to an https:// URL.
$explorer = Join-Path $env:WINDIR "explorer.exe"
if (-not (Test-Path -LiteralPath $explorer -PathType Leaf)) {
    throw "Windows Explorer could not be found."
}
$temporaryShortcut = Join-Path $shortcutFolder (
    ".Yuksalish-Workspace-" + [guid]::NewGuid().ToString("N") + ".lnk"
)
try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($temporaryShortcut)
    $shortcut.TargetPath = $explorer
    $shortcut.Arguments = $uri.AbsoluteUri
    $shortcut.IconLocation = "$installedIcon,0"
    $shortcut.Description = "Yuksalish Workspace"
    $shortcut.Save()

    $saved = $shell.CreateShortcut($temporaryShortcut)
    if ($saved.TargetPath -ne $explorer -or
        $saved.Arguments -ne $uri.AbsoluteUri -or
        $saved.IconLocation -ne "$installedIcon,0") {
        throw "The desktop shortcut did not retain its target or icon."
    }
    Move-Item -LiteralPath $temporaryShortcut -Destination $shortcutPath -Force
}
finally {
    if (Test-Path -LiteralPath $temporaryShortcut) {
        Remove-Item -LiteralPath $temporaryShortcut -Force
    }
}
Write-Host "Desktop shortcut: $shortcutPath"
Write-Host "Shortcut icon: $installedIcon"
