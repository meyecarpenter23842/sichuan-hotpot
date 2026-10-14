param(
  [Parameter(Mandatory=$true)][string]$KeyPath,
  [Parameter(Mandatory=$true)][string]$Server,
  [Parameter(Mandatory=$true)][string]$Username,
  [Parameter(Mandatory=$true)][string]$Email
)
$ErrorActionPreference = 'Stop'
if ($Server -notmatch '^[a-zA-Z0-9.-]+$') { throw 'Invalid VPS hostname' }
if ($Username -cnotmatch '^[a-z][a-z0-9._-]{2,31}$') { throw 'Invalid username' }
if ($Email -cnotmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$' -or $Email -cne $Email.ToLowerInvariant()) {
  throw 'Invalid email'
}
if (!(Test-Path -LiteralPath $KeyPath -PathType Leaf)) { throw 'SSH key not found' }
$helper = Join-Path $PSScriptRoot '..\..\infra\vps\hotpot-first-owner.py'
if (!(Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'Reviewed OWNER bootstrap helper not found' }

Write-Host 'OWNER onboarding: email OTP required. Password and OTP stay hidden.'
$secret = Read-Host 'New OWNER password' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
$otpSecret = $null
$otpPtr = [IntPtr]::Zero
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  if ($password.Length -lt 6 -or $password.Length -gt 128 -or
      $password.IndexOf([char]10) -ge 0 -or $password.IndexOf([char]13) -ge 0) {
    throw 'Invalid password length or characters'
  }
  $packet = @{ username = $Username; email = $Email; password = $password } | ConvertTo-Json -Compress
  $password = $null
  $encodedSource = [Convert]::ToBase64String([IO.File]::ReadAllBytes($helper))
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = 'ssh.exe'
  $info.UseShellExecute = $false
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $bootstrap = "sudo -n /usr/bin/python3 -u -c 'import sys,base64;exec(base64.b64decode(sys.stdin.buffer.readline()))'"
  $info.Arguments = '-T -i "' + $KeyPath.Replace('"','') + '" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 ubuntu@' + $Server + ' "' + $bootstrap + '"'
  $process = [Diagnostics.Process]::Start($info)
  if ($null -eq $process) { throw 'SSH could not start' }
  $process.StandardInput.WriteLine($encodedSource)
  $process.StandardInput.WriteLine($packet)
  $packet = $null
  $process.StandardInput.Flush()
  $phase = $process.StandardOutput.ReadLine()
  if ($phase -ne 'owner_bootstrap=OTP_SENT') {
    $process.StandardInput.Close()
    throw 'OWNER bootstrap blocked before OTP; no account created'
  }
  Write-Host 'OTP sent by Resend. Check your inbox (10 minute expiry).'
  $otpSecret = Read-Host 'Six-digit OWNER email OTP' -AsSecureString
  $otpPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($otpSecret)
  $otp = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($otpPtr)
  if ($otp -cnotmatch '^[0-9]{6}$') {
    $process.StandardInput.Close()
    throw 'Invalid OTP format'
  }
  $process.StandardInput.WriteLine($otp)
  $otp = $null
  $process.StandardInput.Close()
  if (!$process.WaitForExit(45000)) {
    $process.Kill()
    throw 'OWNER bootstrap timed out'
  }
  $proof = $process.StandardOutput.ReadToEnd().Trim()
  $null = $process.StandardError.ReadToEnd()
  if ($process.ExitCode -ne 0 -or $proof -ne 'owner_bootstrap=PASS;email_verified=PASS') {
    throw 'OWNER bootstrap not confirmed. Do not retry blindly.'
  }
  Write-Host 'OWNER created: PASS. Email verified: PASS. No production migration.'
} catch {
  Write-Error 'OWNER bootstrap: NOT CONFIRMED. Database and OTP must be checked before retry.'
  exit 1
} finally {
  if ($otpPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($otpPtr) }
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  if ($otpSecret) { $otpSecret.Dispose() }
  $secret.Dispose()
}
