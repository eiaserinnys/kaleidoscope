param(
  [Parameter(Mandatory = $true)][string]$OutFile
)

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public class VisibleWindow {
    public uint pid;
    public string process_name;
    public string title;
    public List<string> children = new List<string>();
}

public static class VisibleWindows {
    private delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maxCount);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

    private static string Text(IntPtr hwnd) {
        var text = new StringBuilder(4096);
        GetWindowText(hwnd, text, text.Capacity);
        return text.ToString();
    }

    public static VisibleWindow[] Collect() {
        var windows = new List<VisibleWindow>();
        EnumWindows((hwnd, ignored) => {
            if (!IsWindowVisible(hwnd)) return true;
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            string name;
            try { name = Process.GetProcessById((int)pid).ProcessName; }
            catch (ArgumentException) { name = ""; }
            var window = new VisibleWindow { pid = pid, process_name = name, title = Text(hwnd) };
            EnumChildWindows(hwnd, (child, childIgnored) => {
                window.children.Add(Text(child));
                return true;
            }, IntPtr.Zero);
            windows.Add(window);
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }
}
'@

ConvertTo-Json -InputObject @([VisibleWindows]::Collect()) -Depth 4 | Set-Content -Encoding utf8 $OutFile
