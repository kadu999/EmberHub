<#
.SYNOPSIS
    把 RetroArch 的「呼出菜单」手柄组合键钉成 Start + Select（cfg 值 "4"）。

.DESCRIPTION
    RetroArch 默认 input_menu_toggle_gamepad_combo = "0"（关闭），只有键盘 F1 能开菜单，
    所以游戏里按 Start + Select 没反应。EmberHub 的预置会把 app 自己装的那份改成 "4"，
    但手动装的 RetroArch（或预置没生效的那份）不会被改 —— 这个脚本直接改机器上所有
    retroarch.cfg，只动这一行，其它设置原样保留。

    注意：运行前先把 RetroArch 完全退出（它退出时会回写 cfg，会盖掉修改）。

.EXAMPLE
    # 先看有哪些、当前值是几（只看不改，默认行为）
    powershell -ExecutionPolicy Bypass -File scripts/windows/fix-retroarch-menu-combo.ps1

.EXAMPLE
    # 真改（全部钉成 "4" = Start + Select）
    powershell -ExecutionPolicy Bypass -File scripts/windows/fix-retroarch-menu-combo.ps1 -Apply

.EXAMPLE
    # 模拟器装在 D 盘
    powershell -ExecutionPolicy Bypass -File scripts/windows/fix-retroarch-menu-combo.ps1 -Apply -Drive 'C:\','D:\'
#>
[CmdletBinding()]
param(
    # 不加 = 只看不改；加 -Apply 才真正写入
    [switch]$Apply,
    # 组合键取值：0=None 1=Down+Y+L1+R1 2=L3+R3 3=L1+R1+Start+Select 4=Start+Select 5=L3+R1 6=L1+R1
    [int]$Combo = 4,
    # 从哪些盘符开始找
    [string[]]$Drive = @("C:\"),
    # 递归深度（越深越慢）
    [int]$Depth = 8
)

$ErrorActionPreference = "Stop"

$line = 'input_menu_toggle_gamepad_combo = "' + $Combo + '"'
$re = [regex]'(?m)^[ \t]*input_menu_toggle_gamepad_combo[ \t]*=.*$'

Write-Host "目标值：$line$(if ($Combo -eq 4) { '   (4 = Start + Select)' } else { '' })" -ForegroundColor Cyan
Write-Host "搜索：$($Drive -join ', ')  深度 $Depth$(if (-not $Apply) { '   [只看不改，加 -Apply 才写入]' })" -ForegroundColor DarkGray

$files = @()
foreach ($d in $Drive) {
    if (Test-Path $d) {
        $files += Get-ChildItem $d -Filter retroarch.cfg -Recurse -Depth $Depth -Force -ErrorAction SilentlyContinue
    }
}
if ($files.Count -eq 0) {
    Write-Host "没找到 retroarch.cfg（模拟器可能还没装，或装在别的盘：-Drive 'D:\'）" -ForegroundColor Yellow
    return
}

$changed = 0
foreach ($f in $files) {
    $p = $f.FullName
    try { $t = [IO.File]::ReadAllText($p) }
    catch { Write-Host "[跳过] $p （读不了：$($_.Exception.Message)）" -ForegroundColor DarkYellow; continue }

    $m = $re.Matches($t)
    $cur = if ($m.Count) { $m[$m.Count - 1].Value.Trim() } else { "(无此行 → 默认 0/关闭)" }

    if ($m.Count -eq 1 -and $m[0].Value.Trim() -eq $line) {
        Write-Host "[已正确] $p" -ForegroundColor DarkGray
        continue
    }
    if (-not $Apply) {
        Write-Host "[需修改] $p" -ForegroundColor Yellow
        Write-Host "         现在：$cur"
        Write-Host "         改成：$line"
        continue
    }

    $next = if ($m.Count) { $re.Replace($t, $line) } else { $t.TrimEnd() + "`r`n$line`r`n" }
    [IO.File]::WriteAllText($p, $next, (New-Object Text.UTF8Encoding($false)))
    Write-Host "[已修改] $p  （$cur → $line）" -ForegroundColor Green
    $changed++
}

if ($Apply) {
    Write-Host "完成：改了 $changed 个文件。" -ForegroundColor Green
    Write-Host "进游戏后按 Start + Select 即可呼出菜单（等价于 设置 → 输入 → 热键 → 菜单切换）。" -ForegroundColor Green
}
