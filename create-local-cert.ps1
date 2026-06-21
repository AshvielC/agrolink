$ErrorActionPreference = 'Stop'

$certFolder = Join-Path $PSScriptRoot 'certs'
$pfxPath = Join-Path $certFolder 'agrolink-local.pfx'
$cerPath = Join-Path $certFolder 'agrolink-local.cer'

New-Item -ItemType Directory -Force -Path $certFolder | Out-Null

$pfxPassword = ConvertTo-SecureString `
  'ChooseALocalCertificatePassword2026' `
  -AsPlainText `
  -Force

$cert = New-SelfSignedCertificate `
  -DnsName 'localhost' `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -FriendlyName 'AgroLink Local HTTPS' `
  -Type SSLServerAuthentication `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddYears(1)

Export-PfxCertificate `
  -Cert $cert `
  -FilePath $pfxPath `
  -Password $pfxPassword `
  -Force

Export-Certificate `
  -Cert $cert `
  -FilePath $cerPath `
  -Force

Import-Certificate `
  -FilePath $cerPath `
  -CertStoreLocation 'Cert:\CurrentUser\Root'

Write-Host ''
Write-Host 'Local AgroLink HTTPS certificate created successfully.'
Write-Host "PFX file: $pfxPath"
Write-Host "CER file: $cerPath"