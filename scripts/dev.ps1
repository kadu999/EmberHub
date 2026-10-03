# 加载 Visual Studio 开发环境后启动 EmberHub 桌面开发模式。
#
# 为什么需要它：
#   Windows 上的 Rust（MSVC 工具链）链接时依赖 link.exe 与 Windows SDK 的
#   LIB / INCLUDE 环境变量。普通 PowerShell 默认没有这些，会报
#   "linker `link.exe` not found"。本脚本自动用 vcvars64.bat 注入后启动。
#
# 用法:  powershell -ExecutionPolicy Bypass -File scripts/dev.ps1

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
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
cmd /c "`"$vcvars`" >nul && pnpm tauri dev"
