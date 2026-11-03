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
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left,top,right,bottom; }
 [DllImport("user32.dll",SetLastError=true)] static extern bool SystemParametersInfo(uint action,uint param,ref RECT rect,uint flags);
 public static int[] GetWorkArea() {
  var r=new RECT();
  if(!SystemParametersInfo(0x30,0,ref r,0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  return new[]{r.left,r.top,r.right,r.bottom};
 }
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
 static string ReadRaw(string path) {
  try {
   using(var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite | FileShare.Delete))
   using(var reader=new StreamReader(stream)) {
    return reader.ReadToEnd();
   }
  } catch(Exception) { return null; }
 }
 public static string ReadShared(string path,string previous) {
  var text=ReadRaw(path);
  return String.IsNullOrWhiteSpace(text) ? previous : text;
 }
 public static string ReadPhase(string path,string previous,string rejectedPath) {
  var text=ReadRaw(path);
  if(text==null) return previous;
  if(Regex.IsMatch(text,@"\A[a-z0-9-]+\n\z")) return text.Substring(0,text.Length-1);
  // 동시에 쓴 단계 이름이 섞여 중간에 줄바꿈이 들어온 실측이 있어 거절한 내용을 기록한다.
  var hex=String.Join(" ",Array.ConvertAll(text.ToCharArray(),c=>((int)c).ToString("X4")));
  File.AppendAllText(rejectedPath,hex+Environment.NewLine);
  return previous;
 }
 public static string ReadProtection(string path) {
  var text=ReadShared(path,null);
  if(text==null || !text.TrimStart().StartsWith("{") || !text.TrimEnd().EndsWith("}")) return null;
  try {
   foreach(var name in new[]{"client_x","client_y","client_width","client_height","exclude_x","exclude_y","exclude_width","exclude_height"}) Read(text,name);
   return text;
  } catch(Exception) { return null; }
 }
 // 창 테두리 재래스터 안티앨리어싱의 실측 최대 채널 차이는 4/255다.
 const int ProtectedThreshold=8;
 public static int[] ProtectedDiff(byte[] a,byte[] b,string json) {
  int width=GetSystemMetrics(0),height=GetSystemMetrics(1);
  var work=GetWorkArea();
  int clientX=Read(json,"client_x"),clientY=Read(json,"client_y");
  // 작업 표시줄 시계는 앱 창이 아니므로 보호 영역에서 제외한다.
  int left=Math.Max(Math.Max(0,work[0]),clientX),top=Math.Max(Math.Max(0,work[1]),clientY);
  int right=Math.Min(Math.Min(width,work[2]),clientX+Read(json,"client_width")),bottom=Math.Min(Math.Min(height,work[3]),clientY+Read(json,"client_height"));
  int ex=Read(json,"exclude_x"),ey=Read(json,"exclude_y"),er=ex+Read(json,"exclude_width"),eb=ey+Read(json,"exclude_height");
  int n=0,raw=0,maxDelta=0,minX=-1,minY=-1,maxX=-1,maxY=-1;
  for(int y=top;y<bottom;y++) for(int x=left;x<right;x++) {
   if(x>=ex&&x<er&&y>=ey&&y<eb) continue;
   int i=(y*width+x)*4;
   int delta=Math.Max(Math.Abs((int)a[i]-b[i]),Math.Max(Math.Abs((int)a[i+1]-b[i+1]),Math.Abs((int)a[i+2]-b[i+2])));
   if(delta>0) raw++;
   if(delta>ProtectedThreshold) {
    if(n++==0) minX=maxX=x; else { minX=Math.Min(minX,x); maxX=Math.Max(maxX,x); }
    if(minY<0) minY=y; maxY=y;
   }
   maxDelta=Math.Max(maxDelta,delta);
  }
  return new[]{n,raw,maxDelta,minX,minY,maxX,maxY};
 }
 public static void HideConsole() { ShowWindow(GetConsoleWindow(),0); }
}
'@

if ($SelfTest) {
  $testPath = [IO.Path]::GetTempFileName()
  $rejectPath = "$testPath.rejected"
  try {
    [IO.File]::WriteAllText($testPath, '')
    if ([FreezeRecorder]::ReadShared($testPath, '이전') -ne '이전') { throw '빈 상태 읽기 실패' }
    $locked = [IO.File]::Open($testPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
      if ([FreezeRecorder]::ReadShared($testPath, '이전') -ne '이전') { throw '잠긴 상태 읽기 실패' }
    } finally { $locked.Dispose() }
    [IO.File]::WriteAllText($testPath, 'partial')
    if ([FreezeRecorder]::ReadPhase($testPath, '이전', $rejectPath) -ne '이전') { throw '미완성 단계 읽기 실패' }
    [IO.File]::WriteAllText($testPath, "next`0-phase`n")
    if ([FreezeRecorder]::ReadPhase($testPath, '이전', $rejectPath) -ne '이전') { throw '불법 문자가 섞인 단계 읽기 실패' }
    if (-not ([IO.File]::ReadAllText($rejectPath).Contains('0000'))) { throw '거절된 단계의 16진 기록 누락' }
    [IO.File]::WriteAllText($testPath, "next-phase`n")
    if ([FreezeRecorder]::ReadPhase($testPath, '이전', $rejectPath) -ne 'next-phase') { throw '완성된 단계 읽기 실패' }
    [IO.File]::WriteAllText($testPath, '{"client_x":1')
    if ($null -ne [FreezeRecorder]::ReadProtection($testPath)) { throw '미완성 영역 읽기 실패' }
    [IO.File]::WriteAllText($testPath, '{"client_x":1,"client_y":2,"client_width":3,"client_height":4,"exclude_x":5,"exclude_y":6,"exclude_width":7,"exclude_height":8}')
    if ($null -eq [FreezeRecorder]::ReadProtection($testPath)) { throw '완성된 영역 읽기 실패' }
    $width = [FreezeRecorder]::GetSystemMetrics(0)
    $height = [FreezeRecorder]::GetSystemMetrics(1)
    $reference = [byte[]]::new($width * $height * 4)
    $changed = [byte[]]::new($reference.Length)
    $work = [FreezeRecorder]::GetWorkArea()
    $x = $work[0]; $y = $work[1]
    $offset = ($y * $width + $x) * 4
    $changed[$offset] = 4
    $changed[$offset + 4] = 8
    $changed[$offset + 8] = 9
    $changed[$offset + 12] = 255
    $testRegion = ('{{"client_x":{0},"client_y":{1},"client_width":4,"client_height":1,"exclude_x":{2},"exclude_y":{1},"exclude_width":1,"exclude_height":1}}' -f $x, $y, ($x + 3))
    $measured = [FreezeRecorder]::ProtectedDiff($reference, $changed, $testRegion)
    if ($measured[0] -ne 1 -or $measured[1] -ne 3 -or $measured[2] -ne 9 -or $measured[3] -ne ($x + 2) -or $measured[4] -ne $y -or $measured[5] -ne ($x + 2) -or $measured[6] -ne $y) { throw "보호 영역 차이 판정 실패: $measured" }
    if ($work[3] -lt $height) {
      $outside = [byte[]]::new($reference.Length)
      $outside[(($height - 1) * $width + $x) * 4] = 255
      $fullRegion = ('{{"client_x":0,"client_y":0,"client_width":{0},"client_height":{1},"exclude_x":-1,"exclude_y":-1,"exclude_width":0,"exclude_height":0}}' -f $width, $height)
      if (([FreezeRecorder]::ProtectedDiff($reference, $outside, $fullRegion))[0] -ne 0) { throw '작업 영역 밖 픽셀이 보호 영역에 포함됨' }
    }
    Write-Output 'recorder state and pixel self-test passed'
  } finally { [IO.File]::Delete($testPath); [IO.File]::Delete($rejectPath) }
  exit 0
}

[FreezeRecorder]::HideConsole()
$deadline = (Get-Date).AddSeconds(90)
while (-not (Test-Path (Join-Path $Out 'record.request'))) {
  if ((Get-Date) -gt $deadline) { throw 'record.request timeout' }
  Start-Sleep -Milliseconds 20
}

$phasePath = Join-Path $Out 'record.phase'
$rejectedPath = Join-Path $Out 'recorder-phase-rejected.txt'
$protectedPath = Join-Path $Out 'protected.json'
$phase = $null
$protection = $null
while ($null -eq $phase -or $null -eq $protection) {
  if ((Get-Date) -gt $deadline) { throw 'initial recorder state timeout' }
  $phase = [FreezeRecorder]::ReadPhase($phasePath, $null, $rejectedPath)
  $protection = [FreezeRecorder]::ReadProtection($protectedPath)
  if ($null -eq $phase -or $null -eq $protection) { Start-Sleep -Milliseconds 20 }
}
$baseline = [FreezeRecorder]::Frame((Join-Path $Out "phase-$phase-baseline.png"))
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$rows = [System.Collections.Generic.List[string]]::new()
$rows.Add('index,ms,different_pixels,protected_pixels,protected_raw_pixels,protected_max_delta,phase,protected_bbox')
[System.IO.File]::WriteAllText((Join-Path $Out 'record.ready'), '')
[System.IO.File]::WriteAllText((Join-Path $Out "phase-$phase.ready"), '')
$index = 0
$phaseSamples = @{}
$phaseChanges = @{}
while (-not (Test-Path (Join-Path $Out 'record.stop')) -and $clock.Elapsed.TotalSeconds -lt 480) {
  $nextPhase = [FreezeRecorder]::ReadPhase($phasePath, $phase, $rejectedPath)
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
  $bbox = if ($protected[0] -gt 0) { '{0};{1};{2};{3}' -f $protected[3],$protected[4],$protected[5],$protected[6] } else { '' }
  $rows.Add([string]::Format([Globalization.CultureInfo]::InvariantCulture,'{0},{1:F3},{2},{3},{4},{5},{6},{7}',$index,$ms,$diff,$protected[0],$protected[1],$protected[2],$phase,$bbox))
  if ($protected[0] -gt 0 -and -not $phaseChanges.ContainsKey($phase)) {
    [FreezeRecorder]::Frame((Join-Path $Out "phase-$phase-first-change.png")) | Out-Null
    $phaseChanges[$phase] = $true
  }
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
