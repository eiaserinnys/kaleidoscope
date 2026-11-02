param([string]$Out)
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing.Common -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public class FreezeRecorder {
 [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
 public static byte[] Frame(string path) {
  int width=GetSystemMetrics(0),height=GetSystemMetrics(1);
  using(var b=new Bitmap(width,height,PixelFormat.Format32bppArgb)) {
   using(var g=Graphics.FromImage(b)) g.CopyFromScreen(0,0,0,0,b.Size);
   var d=b.LockBits(new Rectangle(0,0,width,height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
   var v=new byte[width*height*4]; Marshal.Copy(d.Scan0,v,0,v.Length);b.UnlockBits(d);
   if(path!=null)b.Save(path,ImageFormat.Png); return v;
  }
 }
 public static int Diff(byte[] a,byte[] b) {int n=0;for(int i=0;i<a.Length;i+=4)if(a[i]!=b[i]||a[i+1]!=b[i+1]||a[i+2]!=b[i+2])n++;return n;}
}
'@
while(-not (Test-Path "$Out/record.request")){Start-Sleep -Milliseconds 20}
$base=[FreezeRecorder]::Frame("$Out/screen-baseline.png")
New-Item "$Out/record.ready" -ItemType File | Out-Null
$clock=[Diagnostics.Stopwatch]::StartNew()
$rows=[Collections.Generic.List[object]]::new()
$index=0
while(-not (Test-Path "$Out/record.stop") -and $clock.Elapsed.TotalSeconds -lt 60){
 $time=$clock.Elapsed.TotalMilliseconds
 $frame=[FreezeRecorder]::Frame($null)
 $diff=[FreezeRecorder]::Diff($base,$frame)
 $rows.Add([PSCustomObject]@{index=$index;ms=$time;different_pixels=$diff})
 if($diff -gt 1000 -and $index % 10 -eq 0){[FreezeRecorder]::Frame("$Out/changed-$index.png") | Out-Null}
 $index++
 Start-Sleep -Milliseconds 8
}
$rows | ConvertTo-Json | Set-Content "$Out/screen-frames.json"
