param([string]$Folder, [string]$EventsPath, [switch]$SelfTest)
$ErrorActionPreference = 'Stop'

# 프로세스가 아니라 시험 폴더를 표시하는 창만 고른다.
function Get-RevealedWindows($Windows, [string]$Target) {
  foreach ($window in $Windows) {
    try { $path = [IO.Path]::GetFullPath($window.Document.Folder.Self.Path).TrimEnd([IO.Path]::DirectorySeparatorChar) }
    catch { continue }
    if ($path -ieq $Target) { $window }
  }
}
if ($SelfTest) {
  $target = Join-Path ([IO.Path]::GetTempPath()) 'ks-close-target'
  $make = { param($path) [pscustomobject]@{ Document = [pscustomobject]@{ Folder = [pscustomobject]@{ Self = [pscustomobject]@{ Path = $path } } } } }
  $ours = & $make ($target.ToUpperInvariant())
  $other = & $make (Join-Path ([IO.Path]::GetTempPath()) 'ks-unrelated')
  $found = @(Get-RevealedWindows @($ours, $other) $target)
  if ($found.Count -ne 1 -or -not [object]::ReferenceEquals($found[0], $ours)) { throw '시험 폴더 창 선택 자체 시험 실패' }
  if (@(Get-RevealedWindows @($other) $target).Count -ne 0) { throw '다른 폴더 창을 선택함' }
  Write-Host 'Explorer window filter: 2 passed'
  return
}
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'GitHub Windows 러너에서만 시험 창을 닫습니다.' }
if (-not $Folder -or -not $EventsPath) { throw '시험 폴더와 events 경로가 필요합니다.' }
$target = [IO.Path]::GetFullPath($Folder).TrimEnd([IO.Path]::DirectorySeparatorChar)
$shell = New-Object -ComObject Shell.Application
$deadline = (Get-Date).AddSeconds(10)
do {
  $matches = @(Get-RevealedWindows ($shell.Windows()) $target)
  if ($matches.Count -gt 0) { break }
  Start-Sleep -Milliseconds 100
} while ((Get-Date) -lt $deadline)
if ($matches.Count -eq 0) { throw "reveal이 연 시험 폴더 창을 찾지 못했습니다: $target" }
$handles = @($matches | ForEach-Object { [long]$_.HWND })
foreach ($window in $matches) { $window.Quit() }
$deadline = (Get-Date).AddSeconds(10)
while (@(Get-RevealedWindows ($shell.Windows()) $target).Count -gt 0) {
  if ((Get-Date) -ge $deadline) { throw "시험 폴더 탐색기 창이 닫히지 않았습니다: $target" }
  Start-Sleep -Milliseconds 100
}
$event = @{ step='files-write.reveal-window-cleanup'; data=@{ passed=$true; folder=$target; closed_hwnds=$handles; remaining=0 } }
Add-Content -Encoding utf8 $EventsPath ($event | ConvertTo-Json -Depth 5 -Compress)
Write-Host "시험 폴더 탐색기 창 정리: $($handles -join ', ')"
