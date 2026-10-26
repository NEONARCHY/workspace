[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CertificateFile,

    [Parameter(Mandatory = $true)]
    [string]$ServerIp,

    [string]$DestinationDirectory
)

$ErrorActionPreference = "Stop"
$source = Join-Path $PSScriptRoot "certificate-client"
$certificatePath = (Resolve-Path -LiteralPath $CertificateFile).Path
$address = $null
if (-not [System.Net.IPAddress]::TryParse($ServerIp, [ref]$address) -or
    $address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
    throw "ServerIp must be a LAN IPv4 address."
}
$octets = $address.GetAddressBytes()
if (-not ($octets[0] -eq 10 -or
    ($octets[0] -eq 172 -and $octets[1] -ge 16 -and $octets[1] -le 31) -or
    ($octets[0] -eq 192 -and $octets[1] -eq 168))) {
    throw "ServerIp must be a private LAN IPv4 address."
}

$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
    $certificatePath
)
$constraints = $certificate.Extensions | Where-Object {
    $_ -is [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]
} | Select-Object -First 1
if ($certificate.Subject -ne $certificate.Issuer -or
    -not $constraints -or -not $constraints.CertificateAuthority -or
    $certificate.NotAfter -le [datetime]::Now) {
    throw "The supplied certificate is not a valid self-signed root CA."
}

if (-not $DestinationDirectory) {
    $DestinationDirectory = Join-Path $PSScriptRoot "..\..\out\Yuksalish-LAN-Certificate-Client"
}
$destination = [System.IO.Path]::GetFullPath($DestinationDirectory)
$archive = "$destination.zip"
if ((Test-Path -LiteralPath $destination) -or (Test-Path -LiteralPath $archive)) {
    throw "The destination package already exists. Choose a new destination to preserve it."
}

$rootHash = (Get-FileHash -LiteralPath $certificatePath -Algorithm SHA256).Hash
$iconPath = Join-Path $source "Yuksalish-Workspace.ico"
$iconHash = (Get-FileHash -LiteralPath $iconPath -Algorithm SHA256).Hash
$workspaceUrl = "https://${ServerIp}:8443/"
$template = Get-Content -LiteralPath (Join-Path $source "Install-Yuksalish-LAN-Certificate.cmd.in") -Raw
$batch = $template.Replace("__ROOT_SHA256__", $rootHash).
    Replace("__ICON_SHA256__", $iconHash).
    Replace("__WORKSPACE_URL__", $workspaceUrl)
if ($batch -match "__[A-Z_]+__") { throw "The batch template has an unresolved placeholder." }
$batch = [regex]::Replace($batch, "\r?\n", "`r`n")

New-Item -ItemType Directory -Path $destination | Out-Null
Copy-Item -LiteralPath $certificatePath -Destination (
    Join-Path $destination "Yuksalish-LAN-root.crt"
)
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "trust-root-certificate.ps1") -Destination $destination
Copy-Item -LiteralPath (Join-Path $source "create-workspace-shortcut.ps1") -Destination $destination
Copy-Item -LiteralPath $iconPath -Destination $destination
Set-Content -LiteralPath (Join-Path $destination "Install-Yuksalish-LAN-Certificate.cmd") `
    -Value $batch -Encoding ascii -NoNewline

$readme = @"
Yuksalish Workspace - LAN client certificate

1. Verify the root certificate SHA-256 with the server administrator:
   $rootHash
2. Extract the entire ZIP. Do not run the CMD directly from inside the ZIP.
3. Double-click Install-Yuksalish-LAN-Certificate.cmd as the Windows user
   who will use Workspace. Administrator elevation is not required.
4. The desktop shortcut opens $workspaceUrl in the default browser.
   Its icon is copied into the current user's LocalAppData directory.

Do not distribute a private Caddy key. This package contains only the public CA.
"@
Set-Content -LiteralPath (Join-Path $destination "README.txt") `
    -Value $readme -Encoding utf8
$files = Get-ChildItem -LiteralPath $destination -File
Compress-Archive -LiteralPath @($files.FullName) -DestinationPath $archive
Write-Host "Portable package: $archive"
Write-Host "Workspace URL: $workspaceUrl"
Write-Host "Root certificate SHA-256: $rootHash"
Write-Host "Shortcut icon SHA-256: $iconHash"
