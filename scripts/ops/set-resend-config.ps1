param(
  [Parameter(Mandatory=$true)][string]$KeyPath,
  [Parameter(Mandatory=$true)][string]$Server
)
$ErrorActionPreference = 'Stop'
if ($Server -notmatch '^[a-zA-Z0-9.-]+$') { throw 'Invalid VPS hostname' }
if (!(Test-Path -LiteralPath $KeyPath -PathType Leaf)) { throw 'SSH private key not found' }
$helper = Join-Path $PSScriptRoot '..\..\infra\vps\hotpot-resend-config.py'
if (!(Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'Missing reviewed VPS helper' }
$encodedSource = [Convert]::ToBase64String([IO.File]::ReadAllBytes($helper))
Write-Host 'Nhập Resend API key (ẩn ký tự). Key chỉ truyền qua SSH stdin, không ghi vào GitHub.'
$taskSecret = Read-Host 'Resend API key' -AsSecureString
$taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
try {
  $taskValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer)
  if ($taskValue -notmatch '^re_[a-zA-Z0-9_-]{20,150}$') { throw 'Invalid Resend key format' }
  $taskInfo = [Diagnostics.ProcessStartInfo]::new()
  $taskInfo.FileName = 'ssh.exe'
  $taskInfo.UseShellExecute = $false
  $taskInfo.RedirectStandardInput = $true
  $taskInfo.RedirectStandardOutput = $true
  $taskInfo.RedirectStandardError = $true
  $bootstrap = "sudo -n /usr/bin/python3 -c 'import sys,base64;exec(base64.b64decode(sys.stdin.buffer.readline()))'"
  $taskInfo.Arguments = '-T -i "' + $KeyPath.Replace('"', '') + '" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 ubuntu@' + $Server + ' "' + $bootstrap + '"'
  $taskProcess = [Diagnostics.Process]::Start($taskInfo)
  if ($null -eq $taskProcess) { throw 'SSH could not start' }
  # Two stdin lines: reviewed Python source encoded as base64, then hidden API key.
  # No secret in command arguments, environment variables, files, stdout or logs.
  $taskProcess.StandardInput.WriteLine($encodedSource)
  $taskProcess.StandardInput.WriteLine($taskValue)
  $taskProcess.StandardInput.Close()
  $taskValue = $null
  if (!$taskProcess.WaitForExit(120000)) {
    $taskProcess.Kill()
    throw 'Secure update timed out'
  }
  $taskOutput = $taskProcess.StandardOutput.ReadToEnd().Trim()
  $null = $taskProcess.StandardError.ReadToEnd()
  if ($taskProcess.ExitCode -ne 0 -or
      $taskOutput -notmatch '^resend_config=(PASS|ALREADY_READY);api_live=PASS;api_ready=PASS$') {
    throw 'Resend VPS config blocked or health check failed'
  }
  Write-Host 'Resend VPS configured: PASS. API health: PASS.'
  Write-Host 'Sending a real OTP remains NOT TESTED until exercised in the app.'
} catch {
  Write-Error 'Resend VPS config: NOT CONFIRMED. No secrets are shown. Check SSH trust/permissions or the VPS rollback audit.'
  exit 1
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer)
  $taskSecret.Dispose()
}
