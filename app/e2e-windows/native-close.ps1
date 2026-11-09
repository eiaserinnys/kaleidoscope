# 네이티브 X(WM_CLOSE)와 Alt+F4가 마지막 편집을 저장한 뒤에만 닫는지 확인한다.
# 저장을 막은 파일에서는 프로그램과 초안이 남고 안내가 뜨는지도 본다.
# 시간 초과로 강제 정리한 실행은 성공으로 기록하지 않는다.
param(
  [string]$AppPath = (Join-Path $env:GITHUB_WORKSPACE 'target/release/kaleidoscope-app.exe'),
  [string]$OutRoot = (Join-Path $env:GITHUB_WORKSPACE 'windows-e2e/native-close')
)
$ErrorActionPreference = 'Stop'
if (-not $env:GITHUB_WORKSPACE) { throw 'GITHUB_WORKSPACE가 없습니다.' }
if (-not (Test-Path $AppPath)) { throw "앱 실행 파일이 없습니다: $AppPath" }

# Alt+F4 실행은 앱 안에서 Alt와 F4를 누른 뒤 70ms 뒤에 놓는데, 그 사이 저장을 마친 앱이 끝나
# 놓는 입력이 빠진다. 그러면 Alt가 시스템에 눌린 채 남아 다음 실행과 뒤 단계의 글자 입력이 Alt 조합이
# 된다. 실행 전후에 수식 키를 놓는다. 눌리지 않은 키를 놓는 입력은 아무 일도 하지 않는다.
Add-Type -Namespace KaleidoscopeE2e -Name Keys -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);'
function Release-Modifiers {
  # Alt, Shift, Ctrl, 왼쪽 Windows 키. 2 = KEYEVENTF_KEYUP
  foreach ($vk in @(0x12, 0x10, 0x11, 0x5B)) { [KaleidoscopeE2e.Keys]::keybd_event([byte]$vk, 0, 2, [UIntPtr]::Zero) }
}

function Get-Events([string]$Out) {
  $path = Join-Path $Out 'events.jsonl'
  if (-not (Test-Path $path)) { return @() }
  return @(Get-Content -Encoding utf8 $path | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
}

function Invoke-NativeCloseRun {
  param([string]$Name, [string]$Method, [bool]$SaveFailure)
  $out = Join-Path $OutRoot $Name
  $pick = Join-Path $env:RUNNER_TEMP "kaleidoscope-native-close-$Name-docs"
  $appData = Join-Path $env:RUNNER_TEMP "kaleidoscope-native-close-$Name-appdata"
  $localAppData = Join-Path $env:RUNNER_TEMP "kaleidoscope-native-close-$Name-localappdata"
  $webview = Join-Path $env:RUNNER_TEMP "kaleidoscope-native-close-$Name-webview"
  Remove-Item -Recurse -Force $out, $pick, $appData, $localAppData, $webview -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $out, $pick, $appData, $localAppData, $webview | Out-Null
  & (Join-Path $PSScriptRoot 'reset-app-data.ps1')
  $env:APPDATA = $appData
  $env:LOCALAPPDATA = $localAppData
  $env:WEBVIEW2_USER_DATA_FOLDER = $webview
  $env:KALEIDOSCOPE_E2E_OUT = $out
  $env:KALEIDOSCOPE_E2E_PICK_FOLDER = $pick
  $env:KALEIDOSCOPE_E2E_NATIVE_CLOSE_METHOD = $Method
  $env:KALEIDOSCOPE_E2E_SAVE_FAILURE = if ($SaveFailure) { '1' } else { '' }

  Release-Modifiers
  $app = Start-Process -FilePath $AppPath -ArgumentList @('--e2e-scenario=native-close', "--e2e-out=$out") -RedirectStandardOutput (Join-Path $out 'stdout.log') -RedirectStandardError (Join-Path $out 'stderr.log') -PassThru
  $timedOut = $false
  $exitCode = $null
  try {
    if (-not $app.WaitForExit(120000)) {
      $timedOut = $true
      Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
      if (-not $app.WaitForExit(10000)) { throw "시간 초과 뒤 앱이 끝나지 않음: $Name" }
    } else {
      $exitCode = $app.ExitCode
    }
  } finally {
    if (-not $app.HasExited) {
      Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
      [void]$app.WaitForExit(10000)
    }
    $app.Dispose()
    Release-Modifiers
  }
  if ($timedOut) { throw "시간 초과로 강제 정리된 실행은 성공이 아님: $Name" }

  $events = Get-Events $out
  if ($exitCode -ne 0) { throw "네이티브 닫기 시나리오 실패($Name): $exitCode" }
  foreach ($step in @('start', 'editor.open', 'native-close.input')) {
    if (@($events | Where-Object { $_.step -eq $step }).Count -ne 1) { throw "기록 누락: $Name $step" }
  }
  $expected = [string](@($events | Where-Object { $_.step -eq 'native-close.input' })[0].data.text)
  $requests = @($events | Where-Object { $_.step -eq 'native-close.request' })
  $first = @($requests | Where-Object { -not $_.data.second })
  if ($first.Count -ne 1) { throw "첫 닫기 요청 기록 누락 또는 중복: $Name" }
  if ([double]$first[0].data.delta_ms -ge 1000) { throw "입력에서 닫기 요청까지 1초 이상: $Name $($first[0].data.delta_ms)ms" }
  $content = [IO.File]::ReadAllText((Join-Path $pick 'note.md'))
  if ($content -cne $expected) { throw "디스크 내용이 마지막 입력과 다름: $Name [$content]" }

  if ($SaveFailure) {
    $blocked = @($events | Where-Object { $_.step -eq 'native-close.blocked' })
    if ($blocked.Count -ne 1) { throw "저장 실패로 닫히지 않았다는 기록이 없음: $Name" }
    if (-not $blocked[0].data.notice_shown -or -not $blocked[0].data.draft -or -not $blocked[0].data.main_visible) {
      throw "저장 실패 뒤 안내/초안/창이 남지 않음: $Name"
    }
    if (@($requests | Where-Object { $_.data.second }).Count -ne 1) { throw "두 번째 닫기 요청 기록 누락: $Name" }
  } elseif (@($requests | Where-Object { $_.data.second }).Count -ne 0) {
    throw "예상 밖 두 번째 닫기 요청: $Name"
  }
  Write-Host ("native-close {0}: ok method={1} save_failure={2} delta_ms={3}" -f $Name, $Method, $SaveFailure, $first[0].data.delta_ms)
}

Invoke-NativeCloseRun -Name '01-hwnd' -Method 'hwnd' -SaveFailure $false
Invoke-NativeCloseRun -Name '02-alt-f4' -Method 'alt-f4' -SaveFailure $false
Invoke-NativeCloseRun -Name '03-save-failure' -Method 'hwnd' -SaveFailure $true
Write-Host '네이티브 닫기 저장 시나리오 통과'
