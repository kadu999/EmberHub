# 给 Windows 版 RetroArch 包「预留」主流核心（世嘉 / 索尼 / 任天堂）。
#
# 从 libretro buildbot 下载 Windows x86_64 核心 DLL，注入到 RetroArch.zip 的 cores/ 下。
# 已存在的核心默认跳过；加 -Force 重新下载覆盖。info/ 里的 .info 包内已齐，无需处理。
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File scripts\retroarch-cores.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\retroarch-cores.ps1 -Force
#   powershell -ExecutionPolicy Bypass -File scripts\retroarch-cores.ps1 -Zip "D:\xx\RetroArch.zip"

param(
  [string]$Zip,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

# 预留核心：核心名 -> 覆盖机种（包内已有：mgba/melonds/flycast/kronos/swanstation）
$cores = [ordered]@{
  # 任天堂
  'mesen'            = 'NES / Famicom'
  'snes9x'           = 'SNES / SFC'
  'gambatte'         = 'GB / GBC'
  'mupen64plus_next' = 'Nintendo 64'
  # 世嘉
  'genesis_plus_gx'  = 'Mega Drive / Master System / Game Gear / Sega CD / SG-1000'
  'picodrive'        = '32X（亦支持 MD / MS / GG）'
  # 索尼
  'mednafen_psx_hw'  = 'PlayStation（硬件加速）'
  'ppsspp'           = 'PSP'
}

$base = 'https://buildbot.libretro.com/nightly/windows/x86_64/latest'

# 默认目标：仓库内服务器发行包里的 RetroArch.zip
$repoRoot = Split-Path $PSScriptRoot -Parent
if (-not $Zip) {
  $Zip = Join-Path $repoRoot 'release\server\Emulators\Windows\RetroArch\RetroArch.zip'
}
if (-not (Test-Path $Zip)) {
  throw "未找到 RetroArch.zip：$Zip（先准备 Windows 版 RetroArch 包，或用 -Zip 指定）"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

$zipPath = (Resolve-Path $Zip).Path
$archive = [System.IO.Compression.ZipFile]::Open($zipPath, 'Update')
$tmp = Join-Path $env:TEMP ("retroarch-cores-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  $existing = @{}
  foreach ($e in $archive.Entries) { $existing[$e.FullName] = $true }

  $added = 0
  foreach ($core in $cores.Keys) {
    $entry = "cores/${core}_libretro.dll"
    $entryDot = "./$entry"
    $already = $existing.ContainsKey($entry) -or $existing.ContainsKey($entryDot)
    if ($already -and -not $Force) {
      Write-Host ("跳过 {0,-20} 已存在（{1}）" -f $core, $cores[$core]) -ForegroundColor DarkGray
      continue
    }

    $url = "$base/${core}_libretro.dll.zip"
    $dl = Join-Path $tmp "$core.zip"
    Write-Host ("下载 {0,-20} {1}" -f $core, $cores[$core]) -ForegroundColor Cyan
    $oldEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    curl.exe -sL --fail --connect-timeout 15 -o $dl $url 2>$null
    $code = $LASTEXITCODE
    $ErrorActionPreference = $oldEap
    if ($code -ne 0 -or -not (Test-Path $dl)) { throw "下载失败：$url" }

    $dir = Join-Path $tmp $core
    Expand-Archive -Path $dl -DestinationPath $dir -Force
    $dll = Get-ChildItem $dir -Recurse -Filter "${core}_libretro.dll" | Select-Object -First 1
    if (-not $dll) { throw "压缩包里没找到 ${core}_libretro.dll" }

    # 覆盖旧条目（保持与包内其它核心一致的 ./cores/ 前缀）
    if ($existing.ContainsKey($entryDot)) { $archive.GetEntry($entryDot).Delete() }
    if ($existing.ContainsKey($entry))    { $archive.GetEntry($entry).Delete() }
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive, $dll.FullName, $entryDot, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    Write-Host ("  -> {0}" -f $entryDot) -ForegroundColor Green
    $added++
  }
}
finally {
  $archive.Dispose()
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ("完成：新增/更新 {0} 个核心，包 {1}（{2:N1} MB）" -f $added, $zipPath, ((Get-Item $zipPath).Length/1MB)) -ForegroundColor Green
