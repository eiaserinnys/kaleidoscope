# APPDATA를 덮어써도 Tauri의 Known Folder 경로는 바뀌지 않는다.
# GitHub의 일회용 Windows 러너에서만 앱 전용 폴더를 비운다.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
  throw '앱 데이터 초기화는 GitHub Windows 러너에서만 실행합니다.'
}
if (Get-Process kaleidoscope-app -ErrorAction SilentlyContinue) {
  throw '앞 시나리오의 앱이 실행 중이어서 데이터를 초기화할 수 없습니다.'
}
$config = Get-Content (Join-Path $PSScriptRoot '../src-tauri/tauri.conf.json') | ConvertFrom-Json
foreach ($kind in @('ApplicationData', 'LocalApplicationData')) {
  $path = Join-Path ([Environment]::GetFolderPath($kind)) $config.identifier
  if (Test-Path $path) { Remove-Item -Recurse -Force $path }
  if (Test-Path $path) { throw "앱 데이터가 남았습니다: $path" }
  Write-Host "초기화 확인: $path"
}
