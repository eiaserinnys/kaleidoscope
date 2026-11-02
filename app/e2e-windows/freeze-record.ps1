param([string]$Out)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public class FreezeRecorder {
 [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
 [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr w,int c);
 public static byte[] Frame(string path) {
  int width=GetSystemMetrics(0),height=GetSystemMetrics(1);
  using(var b=new Bitmap(width,height,PixelFormat.Format32bppArgb)) {
   using(var g=Graphics.FromImage(b)) g.CopyFromScreen(0,0,0,0,b.Size);
   var d=b.LockBits(new Rectangle(0,0,width,height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
   var v=new byte[width*height*4]; Marshal.Copy(d.Scan0,v,0,v.Length);b.UnlockBits(d);
   if(!String.IsNullOrEmpty(path))b.Save(path,ImageFormat.Png); return v;
  }
 }
 public static int Diff(byte[] a,byte[] b) {int n=0;for(int i=0;i<a.Length;i+=4)if(a[i]!=b[i]||a[i+1]!=b[i+1]||a[i+2]!=b[i+2])n++;return n;}
 public static int ProtectedDiff(byte[] a,byte[] b) {
  int n=0,w=GetSystemMetrics(0);
  for(int y=31;y<720;y++)for(int x=8;x<w;x++) {
   if(x>=24 && x<215 && y>=115 && y<150)continue;
   int i=(y*w+x)*4;if(a[i]!=b[i]||a[i+1]!=b[i+1]||a[i+2]!=b[i+2])n++;
  }return n;
 }
 public static void Record(string directory) {
  ShowWindow(GetConsoleWindow(),0);
  var deadline=DateTime.UtcNow.AddSeconds(90);
  while(!System.IO.File.Exists(System.IO.Path.Combine(directory,"record.request"))) {
   if(DateTime.UtcNow>deadline)throw new Exception("record.request timeout");
   System.Threading.Thread.Sleep(20);
  }
  var baseline=Frame(System.IO.Path.Combine(directory,"screen-baseline.png"));
  var clock=System.Diagnostics.Stopwatch.StartNew();
  var rows=new System.Collections.Generic.List<string>();rows.Add("index,ms,different_pixels,protected_pixels,phase");
  System.IO.File.WriteAllText(System.IO.Path.Combine(directory,"record.ready"),"");
  int index=0;
  while(!System.IO.File.Exists(System.IO.Path.Combine(directory,"record.stop")) && clock.Elapsed.TotalSeconds<60) {
   double ms=clock.Elapsed.TotalMilliseconds;
   var frame=Frame(null);int diff=Diff(baseline,frame);int protectedDiff=ProtectedDiff(baseline,frame);
   string phase=System.IO.File.ReadAllText(System.IO.Path.Combine(directory,"record.phase"));
   rows.Add(String.Format(System.Globalization.CultureInfo.InvariantCulture,"{0},{1:F3},{2},{3},{4}",index,ms,diff,protectedDiff,phase));
   if(diff>1000 && index%10==0)Frame(System.IO.Path.Combine(directory,"changed-"+index+".png"));
   index++;
  }
  System.IO.File.WriteAllLines(System.IO.Path.Combine(directory,"screen-frames.csv"),rows);
 }

}
'@
[FreezeRecorder]::Record($Out)
