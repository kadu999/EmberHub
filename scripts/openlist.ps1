# EmberHub 中转站（OpenList）一键管理脚本
#
# 安装位置：与 EmberHub 同级目录（..\OpenList），不放进 EmberHub 仓库。
#   E:\WorkSpace\
#   ├─ EmberHub\        ← 模拟器管理器
#   └─ OpenList\        ← 中转站（本脚本安装到这里）
#
# 用法：
#   双击 scripts\openlist.bat            （菜单）
#   powershell -ExecutionPolicy Bypass -File scripts\openlist.ps1 -Action setup
#   -Action: menu | setup | start | stop | restart | open | status
#   -Password: 初始管理员密码（默认 EmberHub@2026）
#   -Force: 强制重新下载

param(
  [ValidateSet('menu', 'setup', 'start', 'stop', 'restart', 'open', 'status')]
  [string]$Action = 'menu',
  [string]$Password = 'EmberHub@2026',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

# ---------------- 路径 ----------------
$repoRoot  = Split-Path $PSScriptRoot -Parent          # ...\EmberHub（仓库根 = 项目根）
$olDir     = Join-Path $repoRoot 'openlist'            # ...\EmberHub\openlist（项目内，已 gitignore）
$exe       = Join-Path $olDir 'openlist.exe'
$dataDb    = Join-Path $olDir 'data\data.db'
$port      = 5244
$webUrl    = "http://127.0.0.1:$port/@manage"
$davUrl    = "http://127.0.0.1:$port/dav"

function Write-Head($t) {
  Write-Host ""
  Write-Host "=== $t ===" -ForegroundColor DarkYellow
}

function Get-AssetName {
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { return 'openlist-windows-arm64-lite.zip' }
  return 'openlist-windows-amd64-lite.zip'
}

function Test-Running {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Install-OpenList {
  Write-Head '安装 / 更新 OpenList'
  New-Item -ItemType Directory -Force $olDir | Out-Null

  if ((Test-Path $exe) -and -not $Force) {
    Write-Host "已存在：$exe" -ForegroundColor Green
    Write-Host "如需重新下载，请加 -Force 参数。" -ForegroundColor DarkGray
  } else {
    $asset = Get-AssetName
    $url = $null
    try {
      $rel = Invoke-RestMethod 'https://api.github.com/repos/OpenListTeam/OpenList/releases/latest' `
        -Headers @{ 'User-Agent' = 'EmberHub' }
      $a = $rel.assets | Where-Object { $_.name -eq $asset } | Select-Object -First 1
      if ($a) { $url = $a.browser_download_url }
    } catch {
      Write-Host "获取最新版本失败，改用默认版本 v4.2.6" -ForegroundColor Yellow
    }
    if (-not $url) {
      $url = "https://github.com/OpenListTeam/OpenList/releases/download/v4.2.6/$asset"
    }

    $zip = Join-Path $olDir 'openlist.zip'
    $mirrors = @('', 'https://gh-proxy.com/', 'https://ghfast.top/', 'https://ghproxy.net/', 'https://mirror.ghproxy.com/')
    $ok = $false
    foreach ($m in $mirrors) {
      Write-Host "尝试下载：$m$url" -ForegroundColor DarkGray
      curl.exe -L --fail --connect-timeout 12 -o $zip "$m$url" 2>$null
      if ($LASTEXITCODE -eq 0 -and (Test-Path $zip) -and (Get-Item $zip).Length -gt 1MB) {
        $ok = $true
        break
      }
    }
    if (-not $ok) { throw "下载失败，请检查网络，或手动下载后解压到 $olDir" }

    Expand-Archive -Path $zip -DestinationPath $olDir -Force
    Remove-Item $zip -Force
    Write-Host "已安装：$exe" -ForegroundColor Green
  }

  if (-not (Test-Path $dataDb)) {
    Write-Host "初始化管理员账号..." -ForegroundColor DarkGray
    & $exe admin set $Password | Out-Null
    Write-Host "管理员账号：admin / $Password（请登录后尽快修改）" -ForegroundColor Yellow
  }
}

function Start-OpenList {
  Write-Head '启动 OpenList'
  if (-not (Test-Path $exe)) {
    Write-Host '尚未安装，先执行安装。' -ForegroundColor Yellow
    Install-OpenList
  }
  if (Test-Running) {
    Write-Host "已在运行：$webUrl" -ForegroundColor Green
    return
  }
  Start-Process -FilePath $exe -ArgumentList 'server' -WorkingDirectory $olDir -WindowStyle Minimized
  Start-Sleep -Seconds 2
  if (Test-Running) {
    Write-Host '已启动 ✅' -ForegroundColor Green
    Write-Host "管理界面：$webUrl"
    Write-Host "WebDAV ：$davUrl"
  } else {
    Write-Host "启动似乎失败，请手动运行：$exe server" -ForegroundColor Yellow
  }
}

function Stop-OpenList {
  Write-Head '停止 OpenList'
  Get-Process openlist -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 800
  if (Test-Running) {
    Write-Host '仍在监听，可能由其他方式启动。' -ForegroundColor Yellow
  } else {
    Write-Host '已停止。' -ForegroundColor Green
  }
}

function Show-Status {
  Write-Head '状态'
  Write-Host "安装目录：$olDir"
  Write-Host ("可执行文件：{0}" -f $(if (Test-Path $exe) { '已安装' } else { '未安装' }))
  if (Test-Running) {
    Write-Host '运行状态：运行中 ✅' -ForegroundColor Green
    Write-Host "管理界面：$webUrl"
    Write-Host "WebDAV ：$davUrl"
    Write-Host '在 EmberHub「存储源」里填 WebDAV 地址即可。' -ForegroundColor DarkGray
  } else {
    Write-Host '运行状态：未运行' -ForegroundColor Yellow
  }
}

function Open-Manage {
  if (-not (Test-Running)) { Start-OpenList }
  Start-Process $webUrl
}

function Show-Menu {
  while ($true) {
    Write-Host ""
    Write-Host '🔥 EmberHub 中转站 (OpenList) 管理器' -ForegroundColor DarkYellow
    Write-Host "   安装目录：$olDir"
    Write-Host '   1) 安装 / 更新 OpenList'
    Write-Host '   2) 启动 OpenList'
    Write-Host '   3) 停止 OpenList'
    Write-Host '   4) 打开管理页面'
    Write-Host '   5) 查看状态'
    Write-Host '   0) 退出'
    $c = Read-Host '请选择'
    switch ($c) {
      '1' { Install-OpenList }
      '2' { Start-OpenList }
      '3' { Stop-OpenList }
      '4' { Open-Manage }
      '5' { Show-Status }
      '0' { return }
      default { Write-Host '无效选择' -ForegroundColor Yellow }
    }
  }
}

switch ($Action) {
  'setup'   { Install-OpenList }
  'start'   { Start-OpenList }
  'stop'    { Stop-OpenList }
  'restart' { Stop-OpenList; Start-OpenList }
  'open'    { Open-Manage }
  'status'  { Show-Status }
  default   { Show-Menu }
}
