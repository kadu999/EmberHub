# Android 开发：编译并运行到模拟器 / 真机。
#
# 前置条件：
#   - JDK 17+
#   - Android SDK（设置 ANDROID_HOME 或 ANDROID_SDK_ROOT，Android Studio 自带）
#   - Android NDK（设置 NDK_HOME）
#   - rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
#   - 首次需先执行一次：pnpm tauri android init（生成并提交 src-tauri/gen/android）
#
# 用法:  powershell -ExecutionPolicy Bypass -File scripts/dev-android.ps1 [-DevHost 192.168.1.12]
#        （或直接双击 scripts\dev-android.bat；模拟器无需传，默认 10.0.2.2；真机传你电脑的局域网 IP）

param(
  # 开发服务器地址（--host）：配合脚本里的 adb reverse，用 127.0.0.1 最稳（走调试通道，
  # 不依赖模拟器/真机的 IP 网络）。如需局域网直连，可传 -DevHost 192.168.1.12。
  [string]$DevHost = "127.0.0.1",
  # 透出 Tauri CLI / Gradle 的详细输出（默认被 CLI 吞掉，编译期看起来像卡死）。
  [switch]$TauriVerbose
)

$ErrorActionPreference = 'Stop'

if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
  throw '未设置 ANDROID_HOME / ANDROID_SDK_ROOT。请先安装 Android SDK（Android Studio）。'
}
if (-not $env:NDK_HOME) {
  Write-Host '警告：未设置 NDK_HOME，Tauri 可能找不到 Android NDK。' -ForegroundColor Yellow
}

# Tauri 的 Gradle rust 插件会按每个 ABI 直接跑 `node tauri android android-studio-script`
# （见 gen/android/buildSrc/.../BuildTask.kt），这条路径**不带 NDK 工具链**，
# 于是需要 C 编译的依赖（如 sevenz-rust2）会报 `linker 'cc' not found` 导致整包构建失败。
# 这里按 NDK_HOME 把链接器 / C 编译器 / 归档器导出到进程环境，Gradle 及其子进程都会继承。
if ($env:NDK_HOME) {
  $ndkBin = Join-Path $env:NDK_HOME 'toolchains\llvm\prebuilt\windows-x86_64\bin'
  if (Test-Path $ndkBin) {
    $api = 24  # 与 minSdk 对齐（见 gen/android/app/build.gradle.kts）
    $ndkTargets = @(
      @{ triple = 'aarch64-linux-android'; clang = "aarch64-linux-android$api-clang.cmd" },
      @{ triple = 'armv7-linux-androideabi'; clang = "armv7a-linux-androideabi$api-clang.cmd" },
      @{ triple = 'i686-linux-android'; clang = "i686-linux-android$api-clang.cmd" },
      @{ triple = 'x86_64-linux-android'; clang = "x86_64-linux-android$api-clang.cmd" }
    )
    $llvmAr = Join-Path $ndkBin 'llvm-ar.exe'
    foreach ($t in $ndkTargets) {
      $triple = $t.triple
      $clang = Join-Path $ndkBin $t.clang
      if (-not (Test-Path $clang)) { continue }
      $linkerVar = 'CARGO_TARGET_' + ($triple -replace '-', '_').ToUpper() + '_LINKER'
      [Environment]::SetEnvironmentVariable($linkerVar, $clang, 'Process')
      # cc-rs 查找 C 编译器：破折号与下划线两种写法都设，避免版本差异
      [Environment]::SetEnvironmentVariable("CC_$triple", $clang, 'Process')
      [Environment]::SetEnvironmentVariable('CC_' + ($triple -replace '-', '_'), $clang, 'Process')
      [Environment]::SetEnvironmentVariable("AR_$triple", $llvmAr, 'Process')
      [Environment]::SetEnvironmentVariable('AR_' + ($triple -replace '-', '_'), $llvmAr, 'Process')
    }
    Write-Host "已按 NDK_HOME 配置 Android 工具链（API $api）。" -ForegroundColor DarkGray
  }
}

# Tauri 会把 Rust 产物符号链接进 gen/android/jniLibs；创建失败会报
# "Creation symbolic link is not allowed for this system"（并连锁误报 node.bat 启动失败）。
# 这里直接实测一次建软链，失败就给出对应办法。
$probeDir = Join-Path $env:TEMP "emberhub-symlink-probe"
$probeLink = Join-Path $env:TEMP "emberhub-symlink-link"
$canSymlink = $false
try {
  Remove-Item $probeDir, $probeLink -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $probeDir | Out-Null
  New-Item -ItemType SymbolicLink -Path $probeLink -Target $probeDir -ErrorAction Stop | Out-Null
  $canSymlink = $true
} catch {
  $canSymlink = $false
} finally {
  Remove-Item $probeLink, $probeDir -Recurse -Force -ErrorAction SilentlyContinue
}
if (-not $canSymlink) {
  Write-Host '警告：当前进程无法创建符号链接，Tauri 的 Android 构建会失败。' -ForegroundColor Yellow
  Write-Host '      1) 开启「开发者模式」：设置 → 系统 → 开发者选项 → 开发人员模式；' -ForegroundColor Yellow
  Write-Host '      2) 或用「管理员」终端跑本脚本；若已是管理员仍失败，先停掉残留的 Gradle 守护进程：' -ForegroundColor Yellow
  Write-Host '         app\src-tauri\gen\android\gradlew.bat --stop' -ForegroundColor Yellow
}

# 脚本位于 scripts/，应用在仓库根的 app/
$appRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'app'
if (-not (Test-Path (Join-Path $appRoot 'src-tauri\gen\android'))) {
  Write-Host '尚未初始化 Android 工程，请先在 app/ 执行：pnpm tauri android init' -ForegroundColor Yellow
}
Set-Location $appRoot
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"

# 用 adb reverse 把设备的 127.0.0.1:5185 / :5244 转发到宿主机（Vite 开发服务器 / OpenList）：
# 走 adb 调试通道，不依赖模拟器/真机的 IP 网络（模拟器没网时也能用）。后台守候，设备一上线就建立转发。
$reverseJob = Start-Job -ScriptBlock {
  while ($true) {
    try {
      if (((& adb devices) -join "`n") -match "\tdevice") {
        & adb reverse tcp:5185 tcp:5185 2>$null | Out-Null  # Vite 开发服务器
        & adb reverse tcp:5244 tcp:5244 2>$null | Out-Null  # OpenList（WebDAV）
      }
    } catch {}
    Start-Sleep -Seconds 3
  }
}
try {
  Write-Host "开发服务器地址（--host）：$DevHost（配合 adb reverse；局域网直连可传 -DevHost <你的IP>）" -ForegroundColor DarkGray
  if ($TauriVerbose) {
    Write-Host "已开启 -TauriVerbose：会显示 Gradle / cargo 的详细输出。" -ForegroundColor DarkGray
    pnpm tauri android dev --host $DevHost -v
  } else {
    Write-Host "注意：编译期 Tauri CLI 会吞掉 Gradle 的任务输出，可能几分钟毫无输出——这是正常的，不是卡死；" -ForegroundColor DarkGray
    Write-Host "      想看进度或实时报错就加 -TauriVerbose 重跑。真正的失败会在最后打印出来。" -ForegroundColor DarkGray
    pnpm tauri android dev --host $DevHost
  }
} finally {
  Stop-Job $reverseJob -ErrorAction SilentlyContinue
  Remove-Job $reverseJob -Force -ErrorAction SilentlyContinue
}
# 收尾自检：确认这轮是否真的装上去了（避免"跑的是旧包"的误判）
$installed = (& adb shell pm list packages 2>$null) -match "com\.kadu\.emberhub"
if ($installed) {
  Write-Host "自检：设备上已有 com.kadu.emberhub ✅" -ForegroundColor Green
  Write-Host "      （若行为像旧版本：Android 的 native 库有时不随安装更新，先 adb uninstall com.kadu.emberhub 再重跑）" -ForegroundColor DarkGray
} else {
  Write-Host "自检：设备上没看到 com.kadu.emberhub —— 本次可能没装成功，往上翻找报错。" -ForegroundColor Yellow
}
