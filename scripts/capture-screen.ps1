<# 截取屏幕指定区域保存为 PNG，用于诊断窗口层级 #>
param([int]$Left = 0, [int]$Top = 0, [int]$Width = 2048, [int]$Height = 1279, [string]$Out = "$env:TEMP\screen-capture.png")
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($Width, $Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($Left, $Top, 0, 0, $bmp.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output ("SAVED=" + $Out)
