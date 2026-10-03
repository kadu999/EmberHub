// EmberHub - Tauri 薄壳
// 只暴露少量系统操作命令，业务逻辑尽量放在前端 TypeScript。
// 详见 docs/ARCHITECTURE.md

use std::io::{Read, Write};
use std::process::Command;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::StreamExt;
use percent_encoding::percent_decode_str;
use serde::Serialize;
use tauri::Emitter;
use tokio::io::AsyncWriteExt;
use url::Url;

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
#[tauri::command]
fn launch_emulator(
    exe_path: String,
    args: Vec<String>,
    workdir: Option<String>,
) -> Result<u32, String> {
    let mut cmd = Command::new(&exe_path);
    cmd.args(&args);
    if let Some(dir) = workdir {
        if !dir.trim().is_empty() {
            cmd.current_dir(dir);
        }
    }
    match cmd.spawn() {
        Ok(child) => Ok(child.id()),
        Err(e) => Err(format!("failed to launch `{}`: {}", exe_path, e)),
    }
}

/// 列出本地目录内容，供 LocalProvider 使用。
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

/// 读取本地文本文件（UTF-8）。
#[tauri::command]
fn read_local_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("failed to read `{}`: {}", path, e))
}

/// 读取本地图片，返回 data URL。
#[tauri::command]
fn read_local_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("failed to read `{}`: {}", path, e))?;
    Ok(to_data_url(&path, &bytes))
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

fn guess_mime(path: &str) -> &'static str {
    let ext = path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn to_data_url(path: &str, bytes: &[u8]) -> String {
    format!("data:{};base64,{}", guess_mime(path), STANDARD.encode(bytes))
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
    let client = reqwest::Client::new();
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
        .map_err(|e| format!("WebDAV request failed: {}", e))?;

    let status = resp.status();
    if status.as_u16() == 401 {
        return Err("认证失败：用户名或密码错误（HTTP 401）".to_string());
    }
    if !status.is_success() && status.as_u16() != 207 {
        return Err(format!("WebDAV 返回 HTTP {}：{}", status, url));
    }
    let body = resp
        .text()
        .await
        .map_err(|e| format!("WebDAV 响应读取失败: {}", e))?;
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
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .basic_auth(&username, Some(&password))
        .send()
        .await
        .map_err(|e| format!("WebDAV request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("WebDAV 返回 HTTP {}：{}", resp.status(), url));
    }
    resp.text()
        .await
        .map_err(|e| format!("WebDAV 响应读取失败: {}", e))
}

/// 读取 WebDAV 图片，返回 data URL。
#[tauri::command]
async fn webdav_read_base64(
    root: String,
    username: String,
    password: String,
    path: String,
) -> Result<String, String> {
    let url = dav_join(&root, &path)?;
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .basic_auth(&username, Some(&password))
        .send()
        .await
        .map_err(|e| format!("WebDAV request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("WebDAV 返回 HTTP {}：{}", resp.status(), url));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("WebDAV 响应读取失败: {}", e))?;
    Ok(to_data_url(&path, &bytes))
}

// ---------------------------------------------------------------------------
// FTP（资源服务器：自建 FTP，账号密码）
// ---------------------------------------------------------------------------

/// FTP 文件/目录条目，`path` 为相对根路径。
#[derive(Serialize)]
pub struct FtpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

fn ftp_join(base: &str, path: &str) -> String {
    let b = base.trim().trim_end_matches('/');
    let p = path.trim().trim_start_matches('/');
    if b.is_empty() {
        if p.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", p)
        }
    } else if p.is_empty() {
        b.to_string()
    } else {
        format!("{}/{}", b, p)
    }
}

fn ftp_connect(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
) -> Result<suppaftp::FtpStream, String> {
    let addr = format!("{}:{}", host, port);
    let mut ftp =
        suppaftp::FtpStream::connect(&addr).map_err(|e| format!("连接 FTP 失败：{}", e))?;
    ftp.login(username, password)
        .map_err(|e| format!("FTP 登录失败：{}", e))?;
    Ok(ftp)
}

fn ftp_child(base_rel: &str, name: &str) -> String {
    if base_rel.is_empty() {
        name.to_string()
    } else {
        format!("{}/{}", base_rel.trim_end_matches('/'), name)
    }
}

/// 返回跳过前 n 个空白分隔字段后的剩余字符串（保留文件名中的空格）。
fn nth_field_rest(line: &str, n: usize) -> Option<String> {
    let mut count = 0;
    let mut in_field = false;
    let mut start = 0usize;
    for (i, c) in line.char_indices() {
        if c.is_whitespace() {
            if in_field {
                count += 1;
                in_field = false;
                if count == n {
                    start = i;
                }
            }
        } else {
            in_field = true;
        }
    }
    if in_field {
        count += 1;
    }
    if count <= n {
        return None;
    }
    let rest = line[start..].trim_start();
    if rest.is_empty() {
        None
    } else {
        Some(rest.to_string())
    }
}

/// 解析 LIST 返回的一行（Unix ls 或 Windows DOS 格式）。
fn parse_list_line(line: &str, base_rel: &str) -> Option<FtpEntry> {
    let line = line.trim_end_matches(['\r', '\n']);
    if line.trim().is_empty() {
        return None;
    }

    // Windows DOS 格式：... <DIR> name
    if let Some(pos) = line.find("<DIR>") {
        let name = line[pos + 5..].trim();
        if name.is_empty() || name == "." || name == ".." {
            return None;
        }
        return Some(FtpEntry {
            name: name.to_string(),
            path: ftp_child(base_rel, name),
            is_dir: true,
            size: 0,
        });
    }

    // Unix ls：perms links owner group size month day time name
    let perms = line.split_whitespace().next()?;
    if !(perms.starts_with('-') || perms.starts_with('d') || perms.starts_with('l')) {
        return None;
    }

    let mut it = line.split_whitespace();
    let _ = it.next(); // perms
    let _ = it.next(); // links
    let _ = it.next(); // owner
    let _ = it.next(); // group
    let size = it.next().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    let _ = it.next(); // month
    let _ = it.next(); // day
    let _ = it.next(); // time

    let name = nth_field_rest(line, 8)?;
    if name == "." || name == ".." {
        return None;
    }
    let path = ftp_child(base_rel, &name);
    Some(FtpEntry {
        name,
        path,
        is_dir: perms.starts_with('d'),
        size,
    })
}

/// 解析 MLSD 返回的一行：`type=file;size=123; name`
fn parse_mlsd_line(line: &str, base_rel: &str) -> Option<FtpEntry> {
    let line = line.trim_end_matches(['\r', '\n']);
    let idx = line.find(' ')?;
    let facts = &line[..idx];
    let name = line[idx + 1..].trim();
    if name.is_empty() || name == "." || name == ".." {
        return None;
    }
    let mut is_dir = false;
    let mut size: u64 = 0;
    for fact in facts.split(';') {
        if let Some(v) = fact.strip_prefix("type=") {
            is_dir = v.eq_ignore_ascii_case("dir")
                || v.eq_ignore_ascii_case("cdir")
                || v.eq_ignore_ascii_case("pdir");
        } else if let Some(v) = fact.strip_prefix("size=") {
            size = v.parse().unwrap_or(0);
        }
    }
    Some(FtpEntry {
        name: name.to_string(),
        path: ftp_child(base_rel, name),
        is_dir,
        size,
    })
}

fn ftp_list_sync(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    base: &str,
    path: &str,
) -> Result<Vec<FtpEntry>, String> {
    let mut ftp = ftp_connect(host, port, username, password)?;
    let full = ftp_join(base, path);

    // 优先 MLSD（结构化），失败则回退 LIST
    let mut out = Vec::new();
    match ftp.mlsd(Some(full.as_str())) {
        Ok(lines) if !lines.is_empty() => {
            for l in &lines {
                if let Some(e) = parse_mlsd_line(l, path) {
                    out.push(e);
                }
            }
        }
        _ => {
            let lines = ftp
                .list(Some(full.as_str()))
                .map_err(|e| format!("FTP 列目录失败：{}", e))?;
            for l in &lines {
                if let Some(e) = parse_list_line(l, path) {
                    out.push(e);
                }
            }
        }
    }
    let _ = ftp.quit();
    Ok(out)
}

/// 列出 FTP 目录。
#[tauri::command]
async fn ftp_list(
    host: String,
    port: u16,
    username: String,
    password: String,
    base: String,
    path: String,
) -> Result<Vec<FtpEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ftp_list_sync(&host, port, &username, &password, &base, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn ftp_read_text_sync(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    base: &str,
    path: &str,
) -> Result<String, String> {
    let mut ftp = ftp_connect(host, port, username, password)?;
    let full = ftp_join(base, path);
    let buf = ftp
        .retr_as_buffer(full.as_str())
        .map_err(|e| format!("FTP 读取失败：{}", e))?;
    let _ = ftp.quit();
    String::from_utf8(buf.into_inner()).map_err(|e| format!("FTP 内容非 UTF-8：{}", e))
}

/// 读取 FTP 文本文件。
#[tauri::command]
async fn ftp_read_text(
    host: String,
    port: u16,
    username: String,
    password: String,
    base: String,
    path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ftp_read_text_sync(&host, port, &username, &password, &base, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 读取 FTP 图片，返回 data URL。
#[tauri::command]
async fn ftp_read_base64(
    host: String,
    port: u16,
    username: String,
    password: String,
    base: String,
    path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let mut ftp = ftp_connect(&host, port, &username, &password)?;
        let full = ftp_join(&base, &path);
        let buf = ftp
            .retr_as_buffer(full.as_str())
            .map_err(|e| format!("FTP 读取失败：{}", e))?;
        let _ = ftp.quit();
        Ok(to_data_url(&path, &buf.into_inner()))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn ftp_download_sync<F: Fn(u64, Option<u64>)>(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    base: &str,
    path: &str,
    dest: &str,
    on_progress: F,
) -> Result<u64, String> {
    let mut ftp = ftp_connect(host, port, username, password)?;
    let full = ftp_join(base, path);
    let part = format!("{}.part", dest);

    let existing: u64 = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if let Some(parent) = std::path::Path::new(&part).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let total_size = ftp.size(full.as_str()).ok().map(|s| s as u64);

    if existing > 0 {
        ftp.resume_transfer(existing as usize)
            .map_err(|e| format!("FTP 续传失败：{}", e))?;
    }
    let mut stream = ftp
        .retr_as_stream(full.as_str())
        .map_err(|e| format!("FTP 下载失败：{}", e))?;
    let mut file = if existing > 0 {
        std::fs::OpenOptions::new()
            .append(true)
            .open(&part)
            .map_err(|e| format!("无法打开文件 {}：{}", part, e))?
    } else {
        std::fs::File::create(&part).map_err(|e| format!("无法创建文件 {}：{}", part, e))?
    };

    let mut total = existing;
    let mut buf = vec![0u8; 64 * 1024];
    let mut last = std::time::Instant::now();
    loop {
        let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        total += n as u64;
        if last.elapsed().as_millis() >= 200 {
            on_progress(total, total_size);
            last = std::time::Instant::now();
        }
    }
    stream
        .finish()
        .map_err(|e| format!("FTP 传输收尾失败：{}", e))?;
    drop(file);
    if let Err(e) = std::fs::rename(&part, dest) {
        if !std::path::Path::new(dest).exists() {
            return Err(format!("重命名失败：{}", e));
        }
    }
    on_progress(total, total_size);
    let _ = ftp.quit();
    Ok(total)
}

/// 从 FTP 下载文件到本地，支持断点续传（REST），返回字节数。
/// 下载过程中通过 `download://progress` 事件上报进度。
#[tauri::command]
async fn ftp_download(
    app: tauri::AppHandle,
    host: String,
    port: u16,
    username: String,
    password: String,
    base: String,
    path: String,
    dest: String,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dest_for_event = dest.clone();
        ftp_download_sync(
            &host,
            port,
            &username,
            &password,
            &base,
            &path,
            &dest,
            move |done, total| emit_download_progress(&app, &dest_for_event, done, total),
        )
    })
    .await
    .map_err(|e| e.to_string())?
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

/// 默认下载目录：程序所在目录（其下包含 Roms/ 与 Emulators/）。
#[tauri::command]
fn default_download_dir() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("无法获取程序路径: {}", e))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "无法获取程序目录".to_string())?;
    Ok(dir.to_string_lossy().to_string())
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

/// 解压 zip 到目标目录。
#[tauri::command]
fn extract_zip(zip_path: String, dest_dir: String) -> Result<(), String> {
    extract_zip_impl(&zip_path, &dest_dir)
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
    let client = reqwest::Client::new();
    let part = format!("{}.part", dest);

    let mut existing: u64 = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    let mut req = client.get(&url).basic_auth(&username, Some(&password));
    if existing > 0 {
        req = req.header("Range", format!("bytes={}-", existing));
    }
    let resp = req.send().await.map_err(|e| format!("WebDAV 请求失败: {}", e))?;
    let status = resp.status();

    if status.as_u16() == 416 {
        // 已下载完整
        let _ = std::fs::rename(&part, &dest);
        emit_download_progress(&app, &dest, existing, Some(existing));
        return Ok(existing);
    }
    if !status.is_success() {
        return Err(format!("WebDAV 返回 HTTP {}：{}", status, url));
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
        let chunk = chunk.map_err(|e| format!("下载中断: {}", e))?;
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

/// 应用信息，供前端展示。
#[tauri::command]
fn app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "EmberHub",
        "version": env!("CARGO_PKG_VERSION"),
        "tagline": "让每一款老游戏，重新燃烧。",
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            launch_emulator,
            list_local_dir,
            read_local_text,
            read_local_base64,
            webdav_list,
            webdav_read_text,
            webdav_read_base64,
            webdav_download,
            ftp_list,
            ftp_read_text,
            ftp_read_base64,
            ftp_download,
            default_download_dir,
            path_exists,
            file_exists,
            ensure_dir,
            read_text_file,
            write_text_file,
            remove_path,
            extract_zip,
            extract_archive,
            app_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod ftp_tests {
    use super::*;

    // 需要本地 FTP：127.0.0.1:2121 test/test → 示例库。
    // 运行：cargo test -- --ignored
    #[test]
    #[ignore]
    fn ftp_list_and_read() {
        let entries =
            ftp_list_sync("127.0.0.1", 2121, "test", "test", "", "").expect("list 失败");
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"manifest.json"), "entries: {:?}", names);
        assert!(names.contains(&"Roms"), "entries: {:?}", names);

        let text = ftp_read_text_sync("127.0.0.1", 2121, "test", "test", "", "manifest.json")
            .expect("read 失败");
        assert!(text.contains("platforms"), "content: {}", text);

        let roms =
            ftp_list_sync("127.0.0.1", 2121, "test", "test", "", "Roms").expect("list Roms 失败");
        let rn: Vec<&str> = roms.iter().map(|e| e.name.as_str()).collect();
        assert!(rn.contains(&"GBA"), "Roms entries: {:?}", rn);

        // 下载（含断点续传）
        let tmp = std::env::temp_dir().join("emberhub_ftp_test_manifest.json");
        let tmp_s = tmp.to_string_lossy().to_string();
        let _ = std::fs::remove_file(&tmp);
        let n = ftp_download_sync("127.0.0.1", 2121, "test", "test", "", "manifest.json", &tmp_s, |_, _| {})
            .expect("download 失败");
        assert!(n > 0, "downloaded {} bytes", n);
        let dl = std::fs::read_to_string(&tmp).expect("read downloaded 失败");
        assert!(dl.contains("platforms"), "downloaded content: {}", dl);

        // 再次下载：文件已存在，应走 REST 续传且不报错
        let n2 = ftp_download_sync("127.0.0.1", 2121, "test", "test", "", "manifest.json", &tmp_s, |_, _| {})
            .expect("resume 失败");
        assert!(n2 >= n, "resume n2={} n={}", n2, n);
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    #[ignore]
    fn ftp_list_world() {
        let dir = "Roms/GBA/media/世界传说 换装迷宫2";
        let entries =
            ftp_list_sync("127.0.0.1", 2121, "test", "test", "", dir).expect("list 失败");
        for e in &entries {
            println!("ENTRY: name={} dir={} size={}", e.name, e.is_dir, e.size);
        }
        assert!(
            entries.iter().any(|e| e.name.to_lowercase() == "boxfront.png"),
            "no boxFront.png"
        );
    }

    #[test]
    #[ignore]
    fn extract_mgba_7z() {
        let src =
            r"E:\WorkSpace\EmberHub\app\examples\sample-library\Emulators\GBA\mGBA-0.10.5-win64.7z";
        let dest = std::env::temp_dir().join("emberhub_mgba_extract");
        let _ = std::fs::remove_dir_all(&dest);
        sevenz_rust2::decompress_file(src, &dest).expect("decompress 7z");
        let top: Vec<String> = std::fs::read_dir(&dest)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        println!("TOP: {:?}", top);
        let exe = dest.join("mGBA-0.10.5-win64").join("mGBA.exe");
        println!("EXE EXISTS: {}", exe.exists());
        assert!(exe.exists(), "expected {:?}", exe);
    }
}
