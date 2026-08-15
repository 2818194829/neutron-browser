<#
  真实 OLE 文件拖放助手（等价于从资源管理器拖拽文件到任意窗口）
  用法: powershell -NoProfile -ExecutionPolicy Bypass -File drag-drop-helper.ps1 -X <目标X> -Y <目标Y> -Path <文件路径> [-HoldMs 1200]
  实现:
    - 后台 STA 线程（纯 C#）: 移动鼠标到目标 -> 按下左键 -> Control.DoDragDrop(FileDrop) 阻塞
    - PowerShell 主线程: 等拖拽稳定后微移鼠标、停留片刻、释放左键 -> drop 落到光标下的窗口
    - 输出 EFFECT=<N>（1=Copy 表示目标窗口接受了拖放）
  注意: PowerShell 脚本块不能在后台线程执行（ScriptBlock.GetContextFromTLS 会崩溃进程），
        所以后台逻辑必须全部是编译好的 C#。
#>
param(
  [Parameter(Mandatory=$true)][int]$X,
  [Parameter(Mandatory=$true)][int]$Y,
  [Parameter(Mandatory=$true)][string]$Path,
  [int]$HoldMs = 1200,
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path)) {
  Write-Output "ERROR: 文件不存在: $Path"
  exit 2
}
$fullPath = (Resolve-Path -LiteralPath $Path).Path

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies @('System.Windows.Forms', 'System.Drawing') -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public static class NativeMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}

public static class DragWorker {
  public static volatile int Effect = -1;
  public static volatile int Elapsed = -1;
  public static volatile string Error = "";

  [ComImport, Guid("00000121-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDropSource {
    [PreserveSig] int QueryContinueDrag([MarshalAs(UnmanagedType.Bool)] bool fEscapePressed, uint grfKeyState);
    [PreserveSig] int GiveFeedback(uint dwEffect);
  }

  // 完全由程序控制的拖放源：不依赖物理鼠标键状态，
  // PowerShell 主线程调用 RequestDrop() 时向 OLE 引擎提交投放。
  class ManualSource : IDropSource {
    public volatile bool Drop = false;
    public volatile bool Cancel = false;
    public int QueryContinueDrag(bool esc, uint ks) {
      if (esc || Cancel) return 1;      // DRAGDROP_S_CANCEL
      if (Drop) return 0x00040100;      // DRAGDROP_S_DROP
      return 0;                          // S_OK -> 继续拖拽
    }
    public int GiveFeedback(uint fx) { return 2; } // DRAGDROP_S_USEDEFAULTCURSORS
  }

  static ManualSource s_source;

  [DllImport("user32.dll")] public static extern bool PostThreadMessage(int idThread, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  public static volatile int ThreadId = -1;

  [DllImport("ole32.dll")] static extern int DoDragDrop(
    System.Runtime.InteropServices.ComTypes.IDataObject pDataObj,
    IDropSource pDropSource, int dwOKEffects, out int pdwEffect);
  [DllImport("ole32.dll")] static extern int OleInitialize(IntPtr pvReserved);

  public static void RequestDrop() {
    if (s_source != null) s_source.Drop = true;
    // 唤醒拖拽线程的消息循环（OLE 引擎阻塞在 GetMessage 中）
    if (ThreadId > 0) {
      for (int i = 0; i < 5; i++) {
        PostThreadMessage(ThreadId, 0x0200, IntPtr.Zero, IntPtr.Zero); // WM_MOUSEMOVE
      }
    }
  }

  public static void Start(int x, int y, string[] files, int holdMs) {
    Thread t = new Thread(ThreadMain);
    t.SetApartmentState(ApartmentState.STA);
    t.IsBackground = true;
    t.Start(new object[] { x, y, files, holdMs });
  }

  private static void ThreadMain(object arg) {
    try {
      object[] a = (object[])arg;
      int x = (int)a[0], y = (int)a[1];
      string[] files = (string[])a[2];

      OleInitialize(IntPtr.Zero);
      Console.WriteLine("[DragThread] start");
      Control src = new Control();
      src.CreateControl();
      Console.WriteLine("[DragThread] ole-ok");
      DataObject data = new DataObject(DataFormats.FileDrop, files);
      s_source = new ManualSource();
      ThreadId = (int)GetCurrentThreadId();
      Console.WriteLine("[DragThread] control-ok tid=" + ThreadId);

      NativeMouse.SetCursorPos(x, y);
      Thread.Sleep(200);
      Console.WriteLine("[DragThread] calling DoDragDrop");

      long t0 = DateTime.Now.Ticks;
      int dropEffect = 0;
      int hr = DoDragDrop((System.Runtime.InteropServices.ComTypes.IDataObject)data,
        (IDropSource)s_source, 1, out dropEffect); // 1 = DROPEFFECT_COPY
      long elapsedMs = (DateTime.Now.Ticks - t0) / TimeSpan.TicksPerMillisecond;
      Console.WriteLine("[DragThread] DoDragDrop returned hr=0x" + hr.ToString("X") + " effect=" + dropEffect + " ms=" + elapsedMs);
      Effect = dropEffect;
      Elapsed = (int)elapsedMs;
      Hr = hr;
    } catch (Exception ex) {
      Error = ex.ToString();
      Console.WriteLine("[DragThread] ERROR: " + ex.ToString());
    }
  }

  public static volatile int Hr = -1;
}
"@

[DragWorker]::Start($X, $Y, @($fullPath), $HoldMs)

# ---- 自检模式：进程内创建一个 TopMost 接收窗口，验证拖放机制本身可用 ----
if ($SelfTest) {
  # 泵消息式等待（目标窗体在拖放期间需要处理消息，Start-Sleep 会阻塞消息泵）
  function Pump([int]$ms) {
    $end = (Get-Date).AddMilliseconds($ms)
    while ((Get-Date) -lt $end) {
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 20
    }
  }

  $script:got = @()
  $target = New-Object System.Windows.Forms.Form
  $target.Text = 'SelfTestTarget'
  $target.StartPosition = 'Manual'
  $target.Location = New-Object System.Drawing.Point(($X - 100), ($Y - 50))
  $target.Size = New-Object System.Drawing.Size(200, 100)
  $target.TopMost = $true
  $target.AllowDrop = $true
  $target.Add_DragEnter({ param($s, $e) $e.Effect = [System.Windows.Forms.DragDropEffects]::Copy })
  $target.Add_DragDrop({
    param($s, $e)
    $script:got = @($e.Data.GetData([System.Windows.Forms.DataFormats]::FileDrop))
    $e.Effect = [System.Windows.Forms.DragDropEffects]::Copy
  })
  $target.Show()
  $target.Activate()
  Pump 500

  # 等拖拽开始并在目标上悬停；持续微动鼠标驱动 OLE 消息循环
  Pump 900
  $elapsed = 0
  $step = 0
  while ($elapsed -lt $HoldMs) {
    $dx = if (($step % 2) -eq 0) { 6 } else { -6 }
    $dy = if (($step % 4) -lt 2) { 4 } else { -4 }
    [NativeMouse]::SetCursorPos($X + $dx, $Y + $dy) | Out-Null
    Pump 200
    $elapsed += 200
    $step++
  }
  [DragWorker]::RequestDrop()
  Pump 800

  Write-Output ("EFFECT=" + [DragWorker]::Effect)
  Write-Output ("ELAPSED-MS=" + [DragWorker]::Elapsed)
  Write-Output ("HR=0x{0:X}" -f [DragWorker]::Hr)
  Write-Output ("ERR=" + [DragWorker]::Error)
  Write-Output ("GOT=" + (($script:got | ForEach-Object { Split-Path $_ -Leaf }) -join ';'))
  $target.Dispose()
  exit 0
}

# 等拖拽开始并在目标上悬停；持续微动鼠标驱动 OLE 消息循环
Start-Sleep -Milliseconds 900
$elapsed = 0
$step = 0
while ($elapsed -lt $HoldMs) {
  $dx = if (($step % 2) -eq 0) { 6 } else { -6 }
  $dy = if (($step % 4) -lt 2) { 4 } else { -4 }
  [NativeMouse]::SetCursorPos($X + $dx, $Y + $dy) | Out-Null
  Start-Sleep -Milliseconds 200
  $elapsed += 200
  $step++
}
# 提交投放 -> 落到光标下的窗口
[DragWorker]::RequestDrop()

# 等后台线程返回
Start-Sleep -Milliseconds 600

Write-Output ("EFFECT=" + [DragWorker]::Effect)
Write-Output ("ELAPSED-MS=" + [DragWorker]::Elapsed)
Write-Output ("HR=0x{0:X}" -f [DragWorker]::Hr)
if ([DragWorker]::Error) { Write-Output ("ERROR=" + [DragWorker]::Error) }

# 诊断：拖放释放时光标下的窗口
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WinProbe {
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(int x, int y);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
}
"@
$h = [WinProbe]::WindowFromPoint($X + 6, $Y + 4)
$t = New-Object System.Text.StringBuilder 256
$c = New-Object System.Text.StringBuilder 256
$null = [WinProbe]::GetWindowText($h, $t, 256)
$null = [WinProbe]::GetClassName($h, $c, 256)
Write-Output ("UNDER=hwnd=0x{0:X} class={1} title={2}" -f $h.ToInt64(), $c.ToString(), $t.ToString())
exit 0
