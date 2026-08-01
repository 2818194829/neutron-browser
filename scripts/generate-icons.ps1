# Regenerates Windows icon assets from the canonical app icon.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$sourcePath = Join-Path $root "icon\Rocket Browser.png"
$pngPath = Join-Path $root "assets\icons\icon.png"
$icoPath = Join-Path $root "assets\icons\icon.ico"
$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)

if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw "Cannot find source icon: $sourcePath"
}

New-Item -ItemType Directory -Path (Split-Path -Parent $pngPath) -Force | Out-Null

$source = [System.Drawing.Image]::FromFile($sourcePath)
try {
  $side = [Math]::Min($source.Width, $source.Height)
  $cropX = [int](($source.Width - $side) / 2)
  $cropY = [int](($source.Height - $side) / 2)

  $square = New-Object System.Drawing.Bitmap($side, $side, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $g = [System.Drawing.Graphics]::FromImage($square)
    $g.DrawImage(
      $source,
      (New-Object System.Drawing.Rectangle(0, 0, $side, $side)),
      (New-Object System.Drawing.Rectangle($cropX, $cropY, $side, $side)),
      [System.Drawing.GraphicsUnit]::Pixel
    )
    $g.Dispose()

    $pngData = @{}
    foreach ($size in $sizes) {
      $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $g = [System.Drawing.Graphics]::FromImage($bitmap)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $g.DrawImage($square, 0, 0, $size, $size)
      $g.Dispose()

      $stream = New-Object System.IO.MemoryStream
      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      $pngData[$size] = $stream.ToArray()
      $stream.Dispose()
      $bitmap.Dispose()

      if ($size -eq 256) {
        [System.IO.File]::WriteAllBytes($pngPath, $pngData[$size])
      }
    }

    $fileStream = [System.IO.File]::Create($icoPath)
    try {
      $writer = New-Object System.IO.BinaryWriter($fileStream)
      $writer.Write([UInt16]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]$sizes.Count)

      $offset = 6 + 16 * $sizes.Count
      foreach ($size in $sizes) {
        $data = $pngData[$size]
        $dimension = if ($size -ge 256) { 0 } else { $size }
        $writer.Write([Byte]$dimension)
        $writer.Write([Byte]$dimension)
        $writer.Write([Byte]0)
        $writer.Write([Byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$data.Length)
        $writer.Write([UInt32]$offset)
        $offset += $data.Length
      }

      foreach ($size in $sizes) {
        $writer.Write($pngData[$size])
      }
      $writer.Flush()
      $writer.Dispose()
    }
    finally {
      $fileStream.Dispose()
    }
  }
  finally {
    $square.Dispose()
  }
}
finally {
  $source.Dispose()
}

Write-Host "[Icons] Generated $pngPath"
Write-Host "[Icons] Generated $icoPath"
