<# 预览 NSIS 安装向导界面：启动安装程序 → 截取向导窗口 → 自动关闭 #>
param(
    [string]$Exe = "build\Neutron Browser Setup 1.10.1.exe",
    [string]$Out = "$env:TEMP\installer-welcome.png"
)

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Preview {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

$exePath = Join-Path $root $Exe
if (-not (Test-Path $exePath)) { throw "Not found: $exePath" }

$proc = Start-Process -FilePath $exePath -PassThru
$script:targetHwnd = [IntPtr]::Zero
$script:targetTitle = ""

$cb = [Win32Preview+EnumWindowsProc]{
    param($h, $l)
    if ([Win32Preview]::IsWindowVisible($h)) {
        $sb = New-Object System.Text.StringBuilder 256
        [void][Win32Preview]::GetWindowText($h, $sb, 256)
        if ($sb.ToString() -match "Neutron Browser") {
            $script:targetHwnd = $h
            $script:targetTitle = $sb.ToString()
            return $false
        }
    }
    return $true
}

for ($i = 0; $i -lt 40 -and $script:targetHwnd -eq [IntPtr]::Zero; $i++) {
    Start-Sleep -Milliseconds 500
    [void][Win32Preview]::EnumWindows($cb, [IntPtr]::Zero)
}

if ($script:targetHwnd -eq [IntPtr]::Zero) {
    Write-Host "PREVIEW=FAIL window not found"
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    exit 1
}

Write-Host ("PREVIEW_TITLE=" + $script:targetTitle)

# 等待向导完全绘制
Start-Sleep -Seconds 3

# 将向导窗口置顶并移到 (100,100)，排除遮挡/位置干扰
[void][Win32Preview]::SetForegroundWindow($script:targetHwnd)
[void][Win32Preview]::SetWindowPos($script:targetHwnd, [IntPtr]::Zero, 100, 100, 0, 0, 0x0041)
Start-Sleep -Seconds 2

# ---- 方式一：PrintWindow 捕获客户端区 ----
$rect = New-Object Win32Preview+RECT
[void][Win32Preview]::GetClientRect($script:targetHwnd, [ref]$rect)
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
Write-Host ("PREVIEW client={0}x{1}" -f $w, $h)

$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[void][Win32Preview]::PrintWindow($script:targetHwnd, $hdc, 2)
[void][Win32Preview]::PrintWindow($script:targetHwnd, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "PREVIEW_SAVED=$Out"

# ---- 方式二：DPI 校正的屏幕截图（含窗口边框）----
$dpi = [Win32Preview]::GetDpiForWindow($script:targetHwnd)
$scale = $dpi / 96.0
$wr = New-Object Win32Preview+RECT
[void][Win32Preview]::GetWindowRect($script:targetHwnd, [ref]$wr)
$pw = [int][math]::Round(($wr.Right - $wr.Left) * $scale)
$ph = [int][math]::Round(($wr.Bottom - $wr.Top) * $scale)
$pl = [int][math]::Round($wr.Left * $scale)
$pt = [int][math]::Round($wr.Top * $scale)
$out2 = [System.IO.Path]::ChangeExtension($Out, $null) + "-screen.png"
$bmp2 = New-Object System.Drawing.Bitmap($pw, $ph)
$g2 = [System.Drawing.Graphics]::FromImage($bmp2)
$g2.CopyFromScreen($pl, $pt, 0, 0, $bmp2.Size)
$bmp2.Save($out2, [System.Drawing.Imaging.ImageFormat]::Png)
$g2.Dispose()
$bmp2.Dispose()
Write-Host ("PREVIEW_SCREEN_SAVED={0} dpi={1} scale={2} rect={3},{4}" -f $out2, $dpi, $scale, $wr.Left, $wr.Top)

# ---- 方式三：固定区域大图（含窗口周边背景）----
$out3 = [System.IO.Path]::ChangeExtension($Out, $null) + "-area.png"
$bmp3 = New-Object System.Drawing.Bitmap(800, 600)
$g3 = [System.Drawing.Graphics]::FromImage($bmp3)
$g3.CopyFromScreen(0, 0, 0, 0, $bmp3.Size)
$bmp3.Save($out3, [System.Drawing.Imaging.ImageFormat]::Png)
$g3.Dispose()
$bmp3.Dispose()
Write-Host ("PREVIEW_AREA_SAVED={0}" -f $out3)

# 关闭向导（WM_CLOSE）
[void][Win32Preview]::PostMessage($script:targetHwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
Start-Sleep -Seconds 2
if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
Write-Host "PREVIEW_DONE"
