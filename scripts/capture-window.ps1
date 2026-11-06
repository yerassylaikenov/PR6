# Captures a real window on this screen (by title substring) into a PNG using PrintWindow.
# Usage: powershell -File scripts\capture-window.ps1 -Title "PR6 - Task 1" -Out reports\screenshots\x.png
param([Parameter(Mandatory)][string]$Title, [Parameter(Mandatory)][string]$Out)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
}
"@
[W]::SetProcessDPIAware() | Out-Null
$script:found = [IntPtr]::Zero
$cb = [W+EnumProc]{ param($h, $l)
  if ([W]::IsWindowVisible($h)) { $sb = New-Object Text.StringBuilder 512; [W]::GetWindowText($h, $sb, 512) | Out-Null
    if ($sb.ToString() -like "*$Title*") { $script:found = $h; return $false } }
  return $true }
[W]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
if ($script:found -eq [IntPtr]::Zero) { Write-Error "window '$Title' not found"; exit 1 }
$h = $script:found
[W]::ShowWindow($h, 9) | Out-Null; [W]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 400
$r = New-Object W+RECT; [W]::GetWindowRect($h, [ref]$r) | Out-Null
$f = New-Object W+RECT; [W]::DwmGetWindowAttribute($h, 9, [ref]$f, 16) | Out-Null
$w = $r.R - $r.L; $hh = $r.B - $r.T
$bmp = New-Object Drawing.Bitmap $w, $hh
$g = [Drawing.Graphics]::FromImage($bmp); $hdc = $g.GetHdc()
[W]::PrintWindow($h, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc); $g.Dispose()
# crop the invisible resize borders (DWM extended frame bounds)
$cx = [Math]::Max(0, $f.L - $r.L); $cy = [Math]::Max(0, $f.T - $r.T)
$cw = [Math]::Min($w - $cx, $f.R - $f.L); $ch = [Math]::Min($hh - $cy, $f.B - $f.T)
$crop = $bmp.Clone((New-Object Drawing.Rectangle $cx, $cy, $cw, $ch), $bmp.PixelFormat)
$dir = Split-Path -Parent $Out; if ($dir) { New-Item -ItemType Directory -Force $dir | Out-Null }
$crop.Save($Out, [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); $crop.Dispose()
Write-Output "saved $Out ($cw x $ch)"
