# 加载 Visual Studio 开发环境后打包 EmberHub 桌面安装包。
#
# Windows 上 Rust（MSVC）链接需要 link.exe 与 Windows SDK 环境，
# 普通 PowerShell 没有，会报 "linker `link.exe` not found"。
#
# 用法:  powershell -ExecutionPolicy Bypass -File scripts/build.ps1

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
$appRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'app'
Set-Location $appRoot

$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
cmd /c "`"$vcvars`" >nul && pnpm tauri build"
