param(
  [Parameter(Mandatory=$true)][string]$KeyPath,
  [Parameter(Mandatory=$true)][string]$Server,
  [Parameter(Mandatory=$true)][string]$BackupDirectory
)
$ErrorActionPreference = 'Stop'
if ($Server -notmatch '^[a-zA-Z0-9.-]+$') { throw 'Invalid server' }
$destination = [IO.Path]::GetFullPath($BackupDirectory)
[IO.Directory]::CreateDirectory($destination) | Out-Null
$identityPath = Join-Path $destination 'recovery-identity.dpapi'
if (Test-Path -LiteralPath $identityPath) { throw 'Existing recovery identity preserved; do not initialize again' }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $destination -AclObject $acl
$options = @('-i', $KeyPath, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10')
# age-keygen stdout is captured in memory, never written as plaintext or displayed.
$identity = (& ssh @options "ubuntu@$Server" 'age-keygen 2>/dev/null' 2>$null) -join "`n"
if ($LASTEXITCODE -ne 0 -or $identity -notmatch 'AGE-SECRET-KEY-') { throw 'Recovery key generation failed' }
$secure = ConvertTo-SecureString $identity -AsPlainText -Force
$protected = ConvertFrom-SecureString $secure
[IO.File]::WriteAllText($identityPath, $protected, [Text.Encoding]::ASCII)
$recipient = ($identity -split "`n" | Where-Object { $_ -match '^# public key: age1' }) -replace '^# public key: ', ''
if ($recipient -notmatch '^age1[0-9a-z]{58}$') { throw 'Recipient validation failed; preserve recovery identity' }
$config = @{age_recipient=$recipient;offsite_mode='windows-pull'} | ConvertTo-Json -Compress
$config | & ssh @options "ubuntu@$Server" 'sudo -n python3 -c "import os,sys,json; p=''/etc/sichuan-hotpot/backup.json''; v=json.load(sys.stdin); fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600); f=os.fdopen(fd,''w''); json.dump(v,f); f.close()"' 2>$null
if ($LASTEXITCODE -ne 0) { throw 'VPS configuration failed; preserve recovery identity and resolve existing config manually' }
$identity = $null
$protected = $null
$secure.Dispose()
Write-Output 'backup_recovery_initialized=PASS;identity=Windows_DPAPI;production_migration_run=no'
