param([Parameter(Mandatory=$true)][long]$Handle, [Parameter(Mandatory=$true)][string]$Path)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class BrowserWindowCapture {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr target, uint flags);
}
'@
$windowHandle = [IntPtr]::new($Handle)
$windowRect = New-Object BrowserWindowCapture+Rect
if (-not [BrowserWindowCapture]::GetWindowRect($windowHandle, [ref]$windowRect)) { throw 'The test window no longer exists.' }
$bitmap = New-Object System.Drawing.Bitmap(($windowRect.Right - $windowRect.Left), ($windowRect.Bottom - $windowRect.Top))
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$deviceContext = $graphics.GetHdc()
try {
  if (-not [BrowserWindowCapture]::PrintWindow($windowHandle, $deviceContext, 2)) { throw 'The test window could not be captured.' }
} finally { $graphics.ReleaseHdc($deviceContext); $graphics.Dispose() }
try { $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $bitmap.Dispose() }
