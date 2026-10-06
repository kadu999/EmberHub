# 加载 Visual Studio 开发环境后打包 EmberHub 桌面安装包。
#
# Windows 上 Rust（MSVC）链接需要 link.exe 与 Windows SDK 环境，
# 普通 PowerShell 没有，会报 "linker `link.exe` not found"。
#
# 用法:  powershell -ExecutionPolicy Bypass -File scripts/build-pc.ps1
#        （或直接双击 scripts\build-pc.bat）
#
# 所有产物统一导出到仓库根 release/desktop/（与编译缓存 target/ 解耦）：
#   release/desktop/<安装包>                              # .msi / setup.exe
#   release/desktop/portable/EmberHub/                    # 解压即用
#   release/desktop/portable/EmberHub-<版本>-win-portable.zip

$ErrorActionPreference = "Stop"

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
  throw "未找到 vswhere，请先安装 Visual Studio C++ 生成工具。"
}

$vsPath = & $vswhere -latest -products * `
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
  -property installationPath
if (-not $vsPath) {
  throw "未找到带 C++ 工具链的 Visual Studio。"
}

$vcvars = Join-Path $vsPath "VC\Auxiliary\Build\vcvars64.bat"
if (-not (Test-Path $vcvars)) {
  throw "未找到 vcvars64.bat：$vcvars"
}

Write-Host "使用 VS 环境: $vcvars" -ForegroundColor DarkGray

# 应用代码位于 app/ 子目录
$repoRoot = Split-Path $PSScriptRoot -Parent
$appRoot  = Join-Path $repoRoot 'app'

# 读取产品名 / 版本（用于便携包命名）
$conf    = Get-Content (Join-Path $appRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$product = $conf.productName
$version = $conf.version

Set-Location $appRoot
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
cmd /c "`"$vcvars`" >nul && pnpm tauri build"

# ---- 导出到 release/desktop/ -------------------------------------------------
$bundleDir   = Join-Path $appRoot 'src-tauri\target\release\bundle'
$exePath     = Join-Path $appRoot "src-tauri\target\release\$product.exe"
$desktopDir  = Join-Path $repoRoot 'release\desktop'
$portableDir = Join-Path $desktopDir 'portable'
$stageDir    = Join-Path $portableDir $product

if (-not (Test-Path $bundleDir)) {
  Write-Host "未找到安装包目录（构建可能失败）：$bundleDir" -ForegroundColor Yellow
  exit 1
}

New-Item -ItemType Directory -Force -Path $desktopDir | Out-Null
Get-ChildItem -Path $bundleDir -Recurse -File |
  Where-Object { $_.Extension -in '.exe', '.msi', '.dmg', '.deb', '.AppImage' } |
  ForEach-Object { Copy-Item -Force $_.FullName $desktopDir }
Write-Host "已导出安装包到 release\desktop\" -ForegroundColor Green

# ---- 便携版：exe + 说明 → release/desktop/portable/ --------------------------
$readmeTpl = Join-Path $PSScriptRoot 'portable\README.txt'
if ((Test-Path $exePath) -and (Test-Path $readmeTpl)) {
  Remove-Item $stageDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
  Copy-Item -Force $exePath (Join-Path $stageDir "$product.exe")
  Copy-Item -Force $readmeTpl (Join-Path $stageDir 'README.txt')

  $zipPath = Join-Path $portableDir "$product-$version-win-portable.zip"
  Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
  Compress-Archive -Path $stageDir -DestinationPath $zipPath -Force
  Write-Host "已生成便携版：release\desktop\portable\$product-$version-win-portable.zip" -ForegroundColor Green
} else {
  Write-Host "跳过便携版打包（缺 exe 或说明模板）：$exePath / $readmeTpl" -ForegroundColor Yellow
}
