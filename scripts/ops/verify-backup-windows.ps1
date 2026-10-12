param(
  [Parameter(Mandatory=$true)][string]$KeyPath,
  [Parameter(Mandatory=$true)][string]$Server,
  [Parameter(Mandatory=$true)][string]$BackupDirectory,
  [Parameter(Mandatory=$true)][string]$BackupId,
  [Parameter(Mandatory=$true)][string]$ExpectedSha256
)
$ErrorActionPreference = 'Stop'
if ($Server -notmatch '^[a-zA-Z0-9.-]+$' -or $BackupId -notmatch '^\d{8}T\d{6}Z-[0-9a-f]{8}$' -or $ExpectedSha256 -notmatch '^[0-9a-f]{64}$') { throw 'Invalid backup parameters' }
$destination = [IO.Path]::GetFullPath($BackupDirectory)
$target = Join-Path $destination "$BackupId.dump.age"
if (Test-Path -LiteralPath $target) { throw 'Existing local backup preserved; inspect before retry' }
$options = @('-i', $KeyPath, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10')
& scp @options "ubuntu@${Server}:/opt/sichuan-hotpot/incoming/$BackupId.dump.age" $target 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Encrypted backup transfer failed' }
$actual = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $ExpectedSha256) { throw 'Offsite backup checksum mismatch' }
# Upload the offsite copy for recovery proof. Production DB is never a restore target.
& scp @options $target "ubuntu@${Server}:/opt/sichuan-hotpot/incoming/$BackupId.restore.age" 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Restore proof transfer failed' }
$secure = ConvertTo-SecureString ([IO.File]::ReadAllText((Join-Path $destination 'recovery-identity.dpapi')))
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $identity = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $identity | & ssh @options "ubuntu@$Server" "sudo -n /usr/local/sbin/hotpot-db-manual --restore '$BackupId' '$ExpectedSha256'" 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'Isolated restore verification failed; migration remains locked' }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $identity = $null
  $secure.Dispose()
}
@{backup_id=$BackupId;sha256=$actual;offsite_verified=$true;restore_verified=$true;verified_at=(Get-Date).ToUniversalTime().ToString('o')} |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination "$BackupId.receipt.json") -Encoding UTF8
Write-Output 'windows_offsite_checksum=PASS;isolated_restore=PASS;production_migration_run=no'
