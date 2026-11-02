param([string]$Out)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
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
 public static int ProtectedDiff(byte[] a,byte[] b,string path) {
  int width=GetSystemMetrics(0),height=GetSystemMetrics(1);
  string json=System.IO.File.ReadAllText(path);
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

[FreezeRecorder]::HideConsole()
$deadline = (Get-Date).AddSeconds(90)
while (-not (Test-Path (Join-Path $Out 'record.request'))) {
  if ((Get-Date) -gt $deadline) { throw 'record.request timeout' }
  Start-Sleep -Milliseconds 20
}

$phasePath = Join-Path $Out 'record.phase'
$protectedPath = Join-Path $Out 'protected.json'
$phase = (Get-Content -Raw $phasePath).Trim()
$baseline = [FreezeRecorder]::Frame((Join-Path $Out "phase-$phase-baseline.png"))
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$rows = [System.Collections.Generic.List[string]]::new()
$rows.Add('index,ms,different_pixels,protected_pixels,phase')
[System.IO.File]::WriteAllText((Join-Path $Out 'record.ready'), '')
[System.IO.File]::WriteAllText((Join-Path $Out "phase-$phase.ready"), '')
$index = 0
$phaseSamples = @{}
while (-not (Test-Path (Join-Path $Out 'record.stop')) -and $clock.Elapsed.TotalSeconds -lt 90) {
  $nextPhase = (Get-Content -Raw $phasePath).Trim()
  if ($nextPhase -ne $phase) {
    [FreezeRecorder]::Frame((Join-Path $Out "phase-$phase-final.png")) | Out-Null
    $phase = $nextPhase
    $baseline = [FreezeRecorder]::Frame((Join-Path $Out "phase-$phase-baseline.png"))
    [System.IO.File]::WriteAllText((Join-Path $Out "phase-$phase.ready"), '')
  }
  $frame = [FreezeRecorder]::Frame($null)
  $diff = [FreezeRecorder]::Diff($baseline, $frame)
  $protected = [FreezeRecorder]::ProtectedDiff($baseline, $frame, $protectedPath)
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
