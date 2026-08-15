<#
  对照实验：把 .txt 文件拖到 Edge 浏览器窗口。
  Edge 是标准 Chromium，若它能接收拖放（EFFECT=1 或标题变化），说明系统拖放正常、
  问题在本应用；若 EFFECT=0 且无反应，说明桌面环境层拦截了所有拖放。
#>
$ErrorActionPreference = 'Stop'

$edgePath = @(
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edgePath) { Write-Output 'ERROR: 未找到 Edge'; exit 2 }

$testFile = Join-Path $env:TEMP 'drag-probe-edge.txt'
Set-Content -Path $testFile -Value 'drag probe for edge' -Encoding UTF8

$proc = Start-Process $edgePath -ArgumentList @('--new-window', 'about:blank') -PassThru
Start-Sleep -Milliseconds 2500

# Edge 若已在运行，新窗口由既有进程托管（启动器进程随即退出）→ 枚举所有 msedge 窗口
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class EnumWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  public static IntPtr Result = IntPtr.Zero;
  public static void Find() {
    EnumWindows((h, l) => {
      var c = new StringBuilder(128); GetClassName(h, c, 128);
      if (c.ToString() != "Chrome_WidgetWin_1" || !IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      var t = new StringBuilder(128); GetWindowText(h, t, 128);
      if (t.Length > 0) { Result = h; return false; }
      return true;
    }, IntPtr.Zero);
  }
}
"@

[EnumWin]::Find()
$h = [EnumWin]::Result
if ($h -eq [IntPtr]::Zero) {
  Start-Sleep -Milliseconds 3000
  [EnumWin]::Find()
  $h = [EnumWin]::Result
}
if ($h -eq [IntPtr]::Zero) { Write-Output 'ERROR: 未找到 Edge 窗口'; exit 2 }

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NP {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(int x, int y);
}
"@

$rect = New-Object NP+RECT
$null = [NP]::GetWindowRect($h, [ref]$rect)
Write-Output ("EDGE-RECT=({0},{1},{2},{3})" -f $rect.L, $rect.T, $rect.R, $rect.B)

# 把 Edge 移到 (200,150)，大小保持
$null = [NP]::SetWindowPos($h, [IntPtr]::Zero, 200, 150, 0, 0, 0x0005)
Start-Sleep -Milliseconds 400
$null = [NP]::GetWindowRect($h, [ref]$rect)
$cx = [int](($rect.L + $rect.R) / 2)
$cy = [int](($rect.T + 120))

$under = [NP]::WindowFromPoint($cx, $cy)
Write-Output ("TARGET=({0},{1}) UNDER=0x{2:X}" -f $cx, $cy, $under.ToInt64())

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\drag-drop-helper.ps1" -X $cx -Y $cy -Path $testFile -HoldMs 1200

Start-Sleep -Milliseconds 800
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WinT {
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
}
"@
$sb = New-Object System.Text.StringBuilder 512
$null = [WinT]::GetWindowText($h, $sb, 512)
Write-Output ("EDGE-TITLE-AFTER=" + $sb.ToString())
Write-Output 'DONE'
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
