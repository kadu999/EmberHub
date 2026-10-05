// EmberHub - Tauri 薄壳
// 只暴露少量系统操作命令，业务逻辑尽量放在前端 TypeScript。
// 详见 docs/ARCHITECTURE.md

use std::sync::{Mutex, OnceLock};

use futures_util::StreamExt;
use percent_encoding::percent_decode_str;
use serde::Serialize;
use tauri::{Emitter, Manager};
use tokio::io::AsyncWriteExt;
use url::Url;

mod platform;

/// 全局复用的 HTTP 客户端：连接池 + 连接超时。
/// 之前每次请求都 `Client::new()`，无法复用 TCP/TLS 连接，扫描时请求一多就明显变慢。
fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .pool_max_idle_per_host(16)
            .build()
            .expect("failed to build HTTP client")
    })
}

// ---------------------------------------------------------------------------
// 失败日志：同时写 stderr 与 <下载目录>/logs/emberhub.log
// ---------------------------------------------------------------------------

/// 日志目录（由前端在启动 / 切换下载目录时用 `log_init` 指定）。
static LOG_DIR: Mutex<String> = Mutex::new(String::new());

/// 当前 UTC 时间的 ISO8601（毫秒），不引入额外依赖。
fn iso_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs() as i64;
    let millis = d.subsec_millis();
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // civil_from_days（Howard Hinnant 算法）
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, day, h, mi, s, millis
    )
}

/// 追加一行日志到 stderr 与日志文件（日志目录未设置时只写 stderr）。
fn log_line(level: &str, tag: &str, message: &str) {
    let line = format!("{} {} [{}] {}\n", iso_now(), level, tag, message);
    eprint!("{}", line);
    let dir = LOG_DIR.lock().map(|g| g.clone()).unwrap_or_default();
    if dir.is_empty() {
        return;
    }
    let path = std::path::Path::new(&dir).join("emberhub.log");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        use std::io::Write;
        let _ = f.write_all(line.as_bytes());
    }
}

fn log_error(tag: &str, message: &str) {
    log_line("ERROR", tag, message);
}

/// 前端指定日志目录（`<下载目录>/logs`）；下载目录变化时重新调用。
#[tauri::command]
fn log_init(dir: String) {
    if let Ok(mut g) = LOG_DIR.lock() {
        *g = dir;
    }
}

// ---------------------------------------------------------------------------
// 本地文件系统
// ---------------------------------------------------------------------------

/// 本地文件/目录条目
#[derive(Serialize)]
pub struct LocalEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

/// 启动外部模拟器并传入参数（如 ROM 路径），返回进程 PID。
/// 平台差异交由 `platform` 模块处理（桌面用 Command，移动端用 Intent）。
#[tauri::command]
fn launch_emulator(
    exe_path: String,
    args: Vec<String>,
    workdir: Option<String>,
) -> Result<u32, String> {
    platform::launch_emulator(exe_path, args, workdir)
}

/// Android：把本地 ROM 通过 FileProvider 以 content:// 交给目标模拟器 App。
/// `package` 为目标 App 包名；`path` 为空表示只打开 App（进模拟器设置）。
/// 桌面端返回「仅 Android 可用」错误（正常不会调用到）。
#[tauri::command]
fn android_launch_app(
    app: tauri::AppHandle,
    package: String,
    path: Option<String>,
    mime: Option<String>,
) -> Result<(), String> {
    platform::android_launch_app(&app, package, path, mime)
}

/// Android：用系统安装器安装本地 APK（会弹安装确认）。
#[tauri::command]
fn android_install_apk(app: tauri::AppHandle, path: String) -> Result<(), String> {
    platform::android_install_apk(&app, path)
}

/// 列出本地目录内容（解压后查找 ROM、读取本地缓存等）。
#[tauri::command]
fn list_local_dir(path: String) -> Result<Vec<LocalEntry>, String> {
    let mut entries = Vec::new();
    let rd = std::fs::read_dir(&path).map_err(|e| format!("failed to read `{}`: {}", path, e))?;
    for item in rd {
        let item = item.map_err(|e| e.to_string())?;
        let metadata = item.metadata().map_err(|e| e.to_string())?;
        entries.push(LocalEntry {
            name: item.file_name().to_string_lossy().to_string(),
            path: item.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }
    Ok(entries)
}

/// 递归列出目录下所有文件，返回相对 root 的 posix 路径（用于判断游戏是否已下载）。
/// 目录不存在时返回空数组，不报错。
#[tauri::command]
fn list_local_files(root: String) -> Result<Vec<String>, String> {
    let base = std::path::Path::new(&root);
    if !base.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    let mut stack = vec![base.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let rd = match std::fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        for entry in rd.flatten() {
            let path = entry.path();
            match entry.metadata() {
                Ok(m) if m.is_dir() => stack.push(path),
                Ok(_) => {
                    if let Ok(rel) = path.strip_prefix(base) {
                        out.push(rel.to_string_lossy().replace('\\', "/"));
                    }
                }
                Err(_) => {}
            }
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// WebDAV（对接 OpenList / NAS / Nextcloud）
// ---------------------------------------------------------------------------

/// WebDAV 文件/目录条目，`path` 为相对根地址的路径。
#[derive(Serialize)]
pub struct DavEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<String>,
}

/// 把根地址和相对路径拼成完整 URL（自动做百分号编码）。
fn dav_join(root: &str, path: &str) -> Result<String, String> {
    let mut url = Url::parse(root).map_err(|e| format!("invalid WebDAV url: {}", e))?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "WebDAV url cannot be a base".to_string())?;
        segments.pop_if_empty();
        for seg in path.split('/').filter(|s| !s.is_empty()) {
            segments.push(seg);
        }
    }
    Ok(url.into())
}

/// 解析 WebDAV 的 PROPFIND 多状态响应。
fn parse_multistatus(xml: &str, root: &str) -> Result<Vec<DavEntry>, String> {
    let doc = roxmltree::Document::parse(xml).map_err(|e| format!("XML parse error: {}", e))?;
    let root_path = Url::parse(root).map(|u| u.path().to_string()).unwrap_or_default();
    let root_prefix = root_path.trim_end_matches('/').to_string();

    let is_dav = |n: &roxmltree::Node, local: &str| {
        n.is_element() && n.tag_name().name() == local && n.tag_name().namespace() == Some("DAV:")
    };

    let mut out = Vec::new();
    for resp in doc.descendants().filter(|n| is_dav(n, "response")) {
        let href = resp
            .descendants()
            .find(|n| is_dav(&n, "href"))
            .and_then(|n| n.text())
            .unwrap_or("")
            .trim()
            .to_string();
        if href.is_empty() {
            continue;
        }

        // href 可能是绝对 URL 或路径，统一取路径部分
        let href_path = match Url::parse(&href) {
            Ok(u) => u.path().to_string(),
            Err(_) => href.clone(),
        };

        // 相对根地址的路径
        let rel_raw = if href_path.starts_with(&root_prefix) {
            href_path[root_prefix.len()..].to_string()
        } else {
            href_path.clone()
        };
        let rel = percent_decode_str(&rel_raw).decode_utf8_lossy().to_string();
        let rel = rel.trim_matches('/').to_string();
        if rel.is_empty() {
            continue; // 根目录自身
        }

        let is_dir = resp.descendants().any(|n| is_dav(&n, "collection"));
        let size = resp
            .descendants()
            .find(|n| is_dav(&n, "getcontentlength"))
            .and_then(|n| n.text())
            .and_then(|t| t.trim().parse::<u64>().ok())
            .unwrap_or(0);
        let modified = resp
            .descendants()
            .find(|n| is_dav(&n, "getlastmodified"))
            .and_then(|n| n.text())
            .map(|s| s.trim().to_string());

        let name = rel.rsplit('/').next().unwrap_or("").to_string();
        out.push(DavEntry {
            name,
            path: rel,
            is_dir,
            size,
            modified,
        });
    }
    Ok(out)
}

/// 列出 WebDAV 目录（Depth: 1）。
#[tauri::command]
async fn webdav_list(
    root: String,
    username: String,
    password: String,
    path: String,
) -> Result<Vec<DavEntry>, String> {
    let url = dav_join(&root, &path)?;
    let client = http_client();
    let resp = client
        .request(
            reqwest::Method::from_bytes(b"PROPFIND").map_err(|e| e.to_string())?,
            &url,
        )
        .basic_auth(&username, Some(&password))
        .header("Depth", "1")
        .header("Content-Type", "application/xml; charset=utf-8")
        .body(
            r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop>
<d:resourcetype/><d:getcontentlength/><d:getlastmodified/>
</d:prop></d:propfind>"#,
        )
        .send()
        .await
        .map_err(|e| {
            let m = format!("WebDAV request failed: {}", e);
            log_error("dav.list", &m);
            m
        })?;

    let status = resp.status();
    if status.as_u16() == 401 {
        return Err("认证失败：用户名或密码错误（HTTP 401）".to_string());
    }
    if !status.is_success() && status.as_u16() != 207 {
        let m = format!("WebDAV 返回 HTTP {}：{}", status, url);
        log_error("dav.list", &m);
        return Err(m);
    }
    let body = resp
        .text()
        .await
        .map_err(|e| {
            let m = format!("WebDAV 响应读取失败: {}", e);
            log_error("dav.list", &m);
            m
        })?;
    parse_multistatus(&body, &root)
}

/// 读取 WebDAV 文本文件。
#[tauri::command]
async fn webdav_read_text(
    root: String,
    username: String,
    password: String,
    path: String,
) -> Result<String, String> {
    let url = dav_join(&root, &path)?;
    let client = http_client();
    let resp = client
        .get(&url)
        .basic_auth(&username, Some(&password))
        .send()
        .await
        .map_err(|e| {
            let m = format!("WebDAV request failed: {}", e);
            log_error("dav.readText", &m);
            m
        })?;
    if !resp.status().is_success() {
        let m = format!("WebDAV 返回 HTTP {}：{}", resp.status(), url);
        log_error("dav.readText", &m);
        return Err(m);
    }
    resp.text().await.map_err(|e| {
        let m = format!("WebDAV 响应读取失败: {}", e);
        log_error("dav.readText", &m);
        m
    })
}

// ---------------------------------------------------------------------------
// 下载 / 解压 / 本地文件操作
// ---------------------------------------------------------------------------

/// 上报下载进度事件（前端监听 "download-progress"）。
fn emit_download_progress(app: &tauri::AppHandle, path: &str, downloaded: u64, total: Option<u64>) {
    let _ = app.emit(
        "download-progress",
        serde_json::json!({ "path": path, "downloaded": downloaded, "total": total }),
    );
}

/// 目录是否可写（用探针文件判断，用于选择便携下载目录）。
fn is_writable(dir: &std::path::Path) -> bool {
    let probe = dir.join(".emberhub-write-test");
    let ok = std::fs::write(&probe, b"").is_ok();
    if ok {
        let _ = std::fs::remove_file(&probe);
    }
    ok
}

/// 默认下载目录：优先程序目录（便携）；不可写（如装在 Program Files）时回退到用户数据目录。
#[tauri::command]
fn default_download_dir(app: tauri::AppHandle) -> Result<String, String> {
    static CACHE: OnceLock<String> = OnceLock::new();
    if let Some(dir) = CACHE.get() {
        return Ok(dir.clone());
    }

    let resolved: Result<String, String> = (|| {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                if is_writable(dir) {
                    return Ok(dir.to_string_lossy().to_string());
                }
            }
        }
        app.path()
            .app_local_data_dir()
            .map(|p| p.to_string_lossy().to_string())
            .map_err(|e| format!("无法获取用户数据目录: {}", e))
    })();

    if let Ok(dir) = &resolved {
        let _ = CACHE.set(dir.clone());
    }
    resolved
}

/// 递归计算文件/目录大小（字节），用于展示缓存占用。
#[tauri::command]
fn path_size(path: String) -> Result<u64, String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Ok(0);
    }
    if p.is_file() {
        return Ok(std::fs::metadata(p).map(|m| m.len()).unwrap_or(0));
    }
    let mut total: u64 = 0;
    let mut stack = vec![p.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let rd = match std::fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        for entry in rd.flatten() {
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                total += meta.len();
            }
        }
    }
    Ok(total)
}

/// 路径是否存在（文件或目录）。
#[tauri::command]
fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// 本地文件是否存在。
#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).is_file()
}

/// 创建目录（递归）。
#[tauri::command]
fn ensure_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// 读取文本文件。
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// 写入文本文件（自动创建父目录）。
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

/// 删除文件或目录。
#[tauri::command]
fn remove_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else if p.exists() {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

fn extract_zip_impl(zip_path: &str, dest_dir: &str) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| format!("打开压缩包失败: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("读取压缩包失败: {}", e))?;
    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = match entry.enclosed_name() {
            Some(p) => std::path::Path::new(dest_dir).join(p),
            None => continue, // 防目录穿越
        };
        if entry.name().ends_with('/') {
            std::fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = outpath.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut outfile).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 按扩展名解压压缩包（支持 zip / 7z）。
#[tauri::command]
fn extract_archive(path: String, dest_dir: String) -> Result<(), String> {
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".7z") {
        sevenz_rust2::decompress_file(&path, &dest_dir)
            .map_err(|e| format!("解压 7z 失败：{}", e))?;
        Ok(())
    } else if lower.ends_with(".zip") {
        extract_zip_impl(&path, &dest_dir)
    } else {
        Err(format!("不支持的压缩格式：{}", path))
    }
}

/// 从 WebDAV 下载文件到本地，支持**断点续传**（若目标已存在则用 Range 续传），返回字节数。
/// 先写入 `dest.part`，成功后改名，避免残缺文件被当作完整缓存。
#[tauri::command]
async fn webdav_download(
    app: tauri::AppHandle,
    root: String,
    username: String,
    password: String,
    path: String,
    dest: String,
) -> Result<u64, String> {
    let url = dav_join(&root, &path)?;
    let client = http_client();
    let part = format!("{}.part", dest);

    let mut existing: u64 = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    let mut req = client.get(&url).basic_auth(&username, Some(&password));
    if existing > 0 {
        req = req.header("Range", format!("bytes={}-", existing));
    }
    let resp = req.send().await.map_err(|e| {
        let m = format!("WebDAV 请求失败: {}", e);
        log_error("dav.download", &m);
        m
    })?;
    let status = resp.status();

    if status.as_u16() == 416 {
        // 已下载完整
        let _ = std::fs::rename(&part, &dest);
        emit_download_progress(&app, &dest, existing, Some(existing));
        return Ok(existing);
    }
    if !status.is_success() {
        let m = format!("WebDAV 返回 HTTP {}：{}", status, url);
        log_error("dav.download", &m);
        return Err(m);
    }

    let append = existing > 0 && status.as_u16() == 206;
    if !append {
        existing = 0;
    }
    let total_size = resp.content_length().map(|c| c + existing);

    if let Some(parent) = std::path::Path::new(&part).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let mut file = if append {
        tokio::fs::OpenOptions::new()
            .append(true)
            .open(&part)
            .await
            .map_err(|e| format!("无法打开文件 {}: {}", part, e))?
    } else {
        tokio::fs::File::create(&part)
            .await
            .map_err(|e| format!("无法创建文件 {}: {}", part, e))?
    };

    let mut total: u64 = existing;
    let mut last = std::time::Instant::now();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            let m = format!("下载中断: {}", e);
            log_error("dav.download", &m);
            m
        })?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        total += chunk.len() as u64;
        if last.elapsed().as_millis() >= 200 {
            emit_download_progress(&app, &dest, total, total_size);
            last = std::time::Instant::now();
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    if let Err(e) = std::fs::rename(&part, &dest) {
        if !std::path::Path::new(&dest).exists() {
            return Err(format!("重命名失败: {}", e));
        }
    }
    emit_download_progress(&app, &dest, total, total_size);
    Ok(total)
}

// ---------------------------------------------------------------------------
// 应用信息
// ---------------------------------------------------------------------------

/// 当前运行平台（编译目标 OS）：windows / linux / macos / android / ios
#[tauri::command]
fn host_os() -> String {
    std::env::consts::OS.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_android_intent::init());

    // 桌面单实例：再次启动时聚焦已有窗口，而不是再开一个。
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }));

    builder
        .invoke_handler(tauri::generate_handler![
            launch_emulator,
            android_launch_app,
            android_install_apk,
            list_local_dir,
            list_local_files,
            webdav_list,
            webdav_read_text,
            webdav_download,
            default_download_dir,
            path_size,
            path_exists,
            file_exists,
            ensure_dir,
            read_text_file,
            write_text_file,
            remove_path,
            extract_archive,
            host_os,
            log_init
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
