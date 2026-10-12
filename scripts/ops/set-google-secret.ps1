param(
  [Parameter(Mandatory=$true)][string]$KeyPath,
  [Parameter(Mandatory=$true)][string]$Server
)
$ErrorActionPreference='Stop'
if ($Server -notmatch '^[a-zA-Z0-9.-]+$') { throw 'Invalid server' }
Write-Host 'Nhap GOOGLE_CLIENT_SECRET hien co. Gia tri duoc an va gui qua SSH stdin.'
$taskSecret = Read-Host 'Google Client Secret' -AsSecureString
$taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
try {
  $taskValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer)
  if ($taskValue -notmatch '^GOCSPX-[A-Za-z0-9_-]{10,200}$') { throw 'Invalid secret format' }
  $taskInfo = [Diagnostics.ProcessStartInfo]::new()
  $taskInfo.FileName = 'ssh.exe'
  $taskInfo.UseShellExecute = $false
  $taskInfo.RedirectStandardInput = $true
  $taskInfo.RedirectStandardOutput = $true
  $taskInfo.RedirectStandardError = $true
  # Paths are quoted as Windows process arguments, never interpreted by a shell.
  $taskInfo.Arguments = '-i "' + $KeyPath.Replace('"','') + '" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 ubuntu@' + $Server + ' sudo -n /usr/local/sbin/hotpot-env-set-google-secret'
  $taskProcess = [Diagnostics.Process]::Start($taskInfo)
  $taskProcess.StandardInput.WriteLine($taskValue)
  $taskProcess.StandardInput.Close()
  $taskValue = $null
  $taskResult = $taskProcess.StandardOutput.ReadToEnd()
  $null = $taskProcess.StandardError.ReadToEnd()
  $taskProcess.WaitForExit()
  if ($taskProcess.ExitCode -ne 0 -or $taskResult -notmatch 'google_secret_configured=PASS') { throw 'Secure configuration failed' }
  Write-Host 'Google secret configured: PASS. Khong restart backend.'
} catch {
  Write-Host 'Google secret configuration: FAIL. Khong hien thi chi tiet nhay cam.'
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer)
  $taskSecret.Dispose()
  Read-Host 'Nhan Enter de dong cua so' | Out-Null
}
