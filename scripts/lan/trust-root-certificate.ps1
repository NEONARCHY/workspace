[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CertificateFile,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{64}$')]
    [string]$ExpectedSha256
)

$ErrorActionPreference = "Stop"
$path = (Resolve-Path -LiteralPath $CertificateFile).Path
$actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
if ($actual -ne $ExpectedSha256) {
    throw "Certificate fingerprint does not match Bakhtiyor's verified fingerprint. Do not install it."
}
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($path)
$constraints = $certificate.Extensions | Where-Object {
    $_ -is [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]
} | Select-Object -First 1
if ($certificate.Subject -ne $certificate.Issuer -or
    -not $constraints -or -not $constraints.CertificateAuthority) {
    throw "The file is not the expected root CA certificate."
}
Import-Certificate -FilePath $path -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
Write-Host "Trusted the verified LAN root CA for the current Windows user only."
