param([string]$Out, [int]$X, [int]$Y, [int]$Width, [int]$Height)
[IO.File]::AppendAllText((Join-Path $Out 'focus-start.log'), "started $((Get-Date).ToString('o'))`r`n")
try {
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[IO.File]::AppendAllText((Join-Path $Out 'focus-start.log'), "assemblies $((Get-Date).ToString('o'))`r`n")
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class ProbeFocus {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
    public int cbSize, flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret;
  }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO info);
}
'@
[IO.File]::AppendAllText((Join-Path $Out 'focus-start.log'), "compiled $((Get-Date).ToString('o'))`r`n")
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Kaleidoscope focus probe'
$form.StartPosition = 'Manual'
$form.SetBounds($X, $Y, $Width, $Height)
$textBox = New-Object System.Windows.Forms.TextBox
$textBox.Text = 'other program draft'
$textBox.SetBounds(20, 30, ($Width - 60), 30)
$form.Controls.Add($textBox)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 30
$timer.Add_Tick({
  $request = Join-Path $Out 'focus.request'
  if (-not (Test-Path $request)) { return }
  $id = [IO.File]::ReadAllText($request)
  [IO.File]::Delete($request)
  $raise = Join-Path $Out 'focus.raise'
  if (Test-Path $raise) {
    [IO.File]::Delete($raise)
    $form.TopMost = $true
  }
  $info = New-Object ProbeFocus+GUITHREADINFO
  $info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($info)
  $thread = [ProbeFocus]::GetWindowThreadProcessId($form.Handle, [IntPtr]::Zero)
  $ok = [ProbeFocus]::GetGUIThreadInfo($thread, [ref]$info)
  $result = @{
    foreground = ([ProbeFocus]::GetForegroundWindow().ToInt64()); window = $form.Handle.ToInt64();
    focused = $textBox.Focused; focus_handle = $info.hwndFocus.ToInt64(); input_handle = $textBox.Handle.ToInt64();
    text = $textBox.Text; selection_start = $textBox.SelectionStart; selection_length = $textBox.SelectionLength;
    caret_ok = $ok; caret_handle = $info.hwndCaret.ToInt64();
    caret = @($info.rcCaret.left, $info.rcCaret.top, $info.rcCaret.right, $info.rcCaret.bottom);
    x = $form.Left; y = $form.Top; width = $form.Width; height = $form.Height;
    click_x = $form.Left + 80; click_y = $form.Top + 70
  }
  $json = $result | ConvertTo-Json -Compress
  $pending = Join-Path $Out "focus-$id.tmp"
  [IO.File]::WriteAllText($pending, $json)
  [IO.File]::Move($pending, (Join-Path $Out "focus-$id.json"))
})
$form.Add_Shown({
  $textBox.Focus(); $textBox.SelectionStart = 5; $timer.Start()
  [IO.File]::AppendAllText((Join-Path $Out 'focus-start.log'), "shown $((Get-Date).ToString('o'))`r`n")
  [IO.File]::WriteAllText((Join-Path $Out 'focus.ready'), '')
})
[System.Windows.Forms.Application]::Run($form)
} catch {
  [IO.File]::AppendAllText((Join-Path $Out 'focus-start.log'), "error $($_.Exception.Message)`r`n")
  exit 1
}
