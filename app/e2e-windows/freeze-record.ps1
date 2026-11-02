param([string]$Out, [switch]$SelfTest)
$ErrorActionPreference = 'Stop'
try {
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
public class FreezeRecorder {
 [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
 [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr w,int c);
 public static byte[] Frame(string path) {
  int width=GetSystemMetrics(0),height=GetSystemMetrics(1);
  using(var b=new Bitmap(width,height,PixelFormat.Format32bppArgb)) {
   using(var g=Graphics.FromImage(b)) g.CopyFromScreen(0,0,0,0,b.Size);
   var d=b.LockBits(new Rectangle(0,0,width,height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
   var v=new byte[width*height*4]; Marshal.Copy(d.Scan0,v,0,v.Length); b.UnlockBits(d);
   if(!String.IsNullOrEmpty(path)) b.Save(path,ImageFormat.Png); return v;
  }
 }
 public static int Diff(byte[] a,byte[] b) { int n=0; for(int i=0;i<a.Length;i+=4) if(a[i]!=b[i]||a[i+1]!=b[i+1]||a[i+2]!=b[i+2]) n++; return n; }
 static int Read(string json,string name) {
  var m=Regex.Match(json,"\\\""+name+"\\\":(-?[0-9]+)");
  if(!m.Success) throw new Exception("protected region is missing "+name);
  return Int32.Parse(m.Groups[1].Value,System.Globalization.CultureInfo.InvariantCulture);
 }
 public static string ReadShared(string path,string previous) {
  try {
   using(var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite | FileShare.Delete))
   using(var reader=new StreamReader(stream)) {
    var text=reader.ReadToEnd();
    return String.IsNullOrWhiteSpace(text) ? previous : text;
   }
  } catch(Exception) { return previous; }
 }
 public static string ReadPhase(string path,string previous) {
  var text=ReadShared(path,null);
  return text != null && text.EndsWith("\n") ? text.Trim() : previous;
 }
 public static string ReadProtection(string path) {
  var text=ReadShared(path,null);
  if(text==null || !text.TrimStart().StartsWith("{") || !text.TrimEnd().EndsWith("}")) return null;
  try {
   foreach(var name in new[]{"client_x","client_y","client_width","client_height","exclude_x","exclude_y","exclude_width","exclude_height"}) Read(text,name);
   return text;
  } catch(Exception) { return null; }
 }
 public static int ProtectedDiff(byte[] a,byte[] b,string json) {
  int width=GetSystemMetrics(0),height=GetSystemMetrics(1);
  int left=Math.Max(0,Read(json,"client_x")),top=Math.Max(0,Read(json,"client_y"));
  int right=Math.Min(width,left+Read(json,"client_width")),bottom=Math.Min(height,top+Read(json,"client_height"));
  int ex=Read(json,"exclude_x"),ey=Read(json,"exclude_y"),er=ex+Read(json,"exclude_width"),eb=ey+Read(json,"exclude_height");
  int n=0;
  for(int y=top;y<bottom;y++) for(int x=left;x<right;x++) {
   if(x>=ex&&x<er&&y>=ey&&y<eb) continue;
   int i=(y*width+x)*4; if(a[i]!=b[i]||a[i+1]!=b[i+1]||a[i+2]!=b[i+2]) n++;
  }
  return n;
 }
 public static void HideConsole() { ShowWindow(GetConsoleWindow(),0); }
}
'@

if ($SelfTest) {
  $testPath = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($testPath, '')
    if ([FreezeRecorder]::ReadShared($testPath, '이전') -ne '이전') { throw '빈 상태 읽기 실패' }
    $locked = [IO.File]::Open($testPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
      if ([FreezeRecorder]::ReadShared($testPath, '이전') -ne '이전') { throw '잠긴 상태 읽기 실패' }
    } finally { $locked.Dispose() }
    [IO.File]::WriteAllText($testPath, 'partial')
    if ([FreezeRecorder]::ReadPhase($testPath, '이전') -ne '이전') { throw '미완성 단계 읽기 실패' }
    [IO.File]::WriteAllText($testPath, "다음`n")
    if ([FreezeRecorder]::ReadPhase($testPath, '이전') -ne '다음') { throw '완성된 단계 읽기 실패' }
    [IO.File]::WriteAllText($testPath, '{"client_x":1')
    if ($null -ne [FreezeRecorder]::ReadProtection($testPath)) { throw '미완성 영역 읽기 실패' }
    [IO.File]::WriteAllText($testPath, '{"client_x":1,"client_y":2,"client_width":3,"client_height":4,"exclude_x":5,"exclude_y":6,"exclude_width":7,"exclude_height":8}')
    if ($null -eq [FreezeRecorder]::ReadProtection($testPath)) { throw '완성된 영역 읽기 실패' }
    Write-Output 'recorder state self-test passed'
  } finally { [IO.File]::Delete($testPath) }
  exit 0
}

[FreezeRecorder]::HideConsole()
$deadline = (Get-Date).AddSeconds(90)
while (-not (Test-Path (Join-Path $Out 'record.request'))) {
  if ((Get-Date) -gt $deadline) { throw 'record.request timeout' }
  Start-Sleep -Milliseconds 20
}

$phasePath = Join-Path $Out 'record.phase'
$protectedPath = Join-Path $Out 'protected.json'
$phase = $null
$protection = $null
while ($null -eq $phase -or $null -eq $protection) {
  if ((Get-Date) -gt $deadline) { throw 'initial recorder state timeout' }
  $phase = [FreezeRecorder]::ReadPhase($phasePath, $null)
  $protection = [FreezeRecorder]::ReadProtection($protectedPath)
  if ($null -eq $phase -or $null -eq $protection) { Start-Sleep -Milliseconds 20 }
}
$baseline = [FreezeRecorder]::Frame((Join-Path $Out "phase-$phase-baseline.png"))
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$rows = [System.Collections.Generic.List[string]]::new()
$rows.Add('index,ms,different_pixels,protected_pixels,phase')
[System.IO.File]::WriteAllText((Join-Path $Out 'record.ready'), '')
[System.IO.File]::WriteAllText((Join-Path $Out "phase-$phase.ready"), '')
$index = 0
$phaseSamples = @{}
while (-not (Test-Path (Join-Path $Out 'record.stop')) -and $clock.Elapsed.TotalSeconds -lt 480) {
  $nextPhase = [FreezeRecorder]::ReadPhase($phasePath, $phase)
  if ($nextPhase -ne $phase) {
    $nextProtection = [FreezeRecorder]::ReadProtection($protectedPath)
    if ($null -eq $nextProtection) { Start-Sleep -Milliseconds 15; continue }
    [FreezeRecorder]::Frame((Join-Path $Out "phase-$phase-final.png")) | Out-Null
    $phase = $nextPhase
    $protection = $nextProtection
    $baseline = [FreezeRecorder]::Frame((Join-Path $Out "phase-$phase-baseline.png"))
    [System.IO.File]::WriteAllText((Join-Path $Out "phase-$phase.ready"), '')
  }
  $frame = [FreezeRecorder]::Frame($null)
  $diff = [FreezeRecorder]::Diff($baseline, $frame)
  $protected = [FreezeRecorder]::ProtectedDiff($baseline, $frame, $protection)
  $ms = $clock.Elapsed.TotalMilliseconds
  $rows.Add([string]::Format([Globalization.CultureInfo]::InvariantCulture,'{0},{1:F3},{2},{3},{4}',$index,$ms,$diff,$protected,$phase))
  if (-not $phaseSamples.ContainsKey($phase)) { $phaseSamples[$phase] = 0 }
  $phaseSamples[$phase]++
  $index++
  Start-Sleep -Milliseconds 15
}
if (-not (Test-Path (Join-Path $Out 'record.stop'))) { throw 'record.stop timeout' }
[FreezeRecorder]::Frame((Join-Path $Out "phase-$phase-final.png")) | Out-Null
[System.IO.File]::WriteAllLines((Join-Path $Out 'screen-frames.csv'), $rows)
$phaseSamples | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $Out 'screen-phase-samples.json')

} catch {
  $message = ($_ | Format-List * -Force | Out-String) + "`n" + $_.ScriptStackTrace
  if ($Out) { [IO.File]::WriteAllText((Join-Path $Out 'recorder-error.txt'), $message) }
  [Console]::Error.WriteLine($message)
  exit 1
}
