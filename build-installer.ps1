$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$pkg = Get-Content -Raw -Encoding UTF8 (Join-Path $root "package.json") | ConvertFrom-Json
$productName = if ($pkg.build.productName) { $pkg.build.productName } else { $pkg.name }
$version = $pkg.version

$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"

Write-Host "[0/4] Regenerating icons from canonical source..."
& (Join-Path $root "scripts\generate-icons.ps1")

Write-Host "[1/4] Building unpacked app..."
npx electron-builder --win --dir --config.electronDist=node_modules/electron/dist --config.win.signAndEditExecutable=false
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$exe = Join-Path $root "build\win-unpacked\$productName.exe"
$icon = Join-Path $root "assets\icons\icon.ico"
$cacheDir = Join-Path $env:LOCALAPPDATA "electron-builder\Cache\winCodeSign"
$rcedit = Get-ChildItem $cacheDir -Recurse -Filter "rcedit-x64.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
if (-not $rcedit) {
  throw "rcedit-x64.exe not found under $cacheDir"
}

Write-Host "[2/4] Writing icon and version info..."
& $rcedit $exe --set-icon $icon --set-version-string ProductName $productName --set-version-string FileDescription $productName --set-version-string CompanyName "Neutron Browser Team" --set-version-string LegalCopyright "Copyright 2024 Neutron Browser Team" --set-file-version $version --set-product-version $version
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[3/4] Building NSIS installer..."
npx electron-builder --win nsis --x64 --prepackaged "build\win-unpacked" --config.electronDist=node_modules/electron/dist --config.win.signAndEditExecutable=false
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[4/4] Done: build\$productName Setup $version.exe"
