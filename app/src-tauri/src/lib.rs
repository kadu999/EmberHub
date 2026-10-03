// EmberHub - Tauri 薄壳
// 只暴露少量系统操作命令，业务逻辑尽量放在前端 TypeScript。
// 详见 docs/ARCHITECTURE.md

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
