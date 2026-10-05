// Electron 主进程：WebDAV（PROPFIND / GET / 流式下载）。
// 用 Node 原生 http/https，绕过浏览器 CORS 与 PROPFIND 预检限制。
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const nodePath = require("node:path");
const { URL } = require("node:url");

/** 把根地址与相对路径拼成完整 URL（逐段编码）。 */
function joinUrl(root, relPath) {
  const u = new URL(root);
  const base = u.pathname.replace(/\/+$/, "");
  const parts = String(relPath || "")
    .split("/")
    .filter((s) => s !== "")
    .map((s) => encodeURIComponent(s));
  u.pathname = [base, ...parts].join("/");
  return u.toString();
}

function basicAuth(username, password) {
  return "Basic " + Buffer.from(`${username}:${password ?? ""}`).toString("base64");
}

function libFor(urlStr) {
  return new URL(urlStr).protocol === "https:" ? https : http;
}

function request(urlStr, method, { username, password, headers, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = libFor(urlStr);
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      },
    );
    req.on("error", reject);
    if (username != null) req.setHeader("Authorization", basicAuth(username, password));
    if (body) req.write(body);
    req.end();
  });
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** 解析 WebDAV 207 Multistatus（对 OpenList 的响应格式足够）。 */
function parseMultistatus(xml, root) {
  let rootPrefix = "";
  try {
    rootPrefix = new URL(root).pathname.replace(/\/+$/, "");
  } catch {
    /* ignore */
  }

  const out = [];
  const blocks = xml.match(/<(?:\w+:)?response\b[\s\S]*?<\/(?:\w+:)?response>/gi) || [];
  for (const block of blocks) {
    const hrefM = block.match(/<(?:\w+:)?href>([\s\S]*?)<\/(?:\w+:)?href>/i);
    if (!hrefM) continue;
    const href = decodeXml(hrefM[1]).trim();
    if (!href) continue;

    let hrefPath = href;
    try {
      hrefPath = new URL(href).pathname;
    } catch {
      /* href 是相对路径 */
    }
    const relRaw = hrefPath.startsWith(rootPrefix) ? hrefPath.slice(rootPrefix.length) : hrefPath;
    const rel = safeDecode(relRaw).replace(/^\/+|\/+$/g, "");
    if (!rel) continue;

    const isDir = /<(?:\w+:)?collection\b/i.test(block);
    const sizeM = block.match(
      /<(?:\w+:)?getcontentlength>([\s\S]*?)<\/(?:\w+:)?getcontentlength>/i,
    );
    const modM = block.match(
      /<(?:\w+:)?getlastmodified>([\s\S]*?)<\/(?:\w+:)?getlastmodified>/i,
    );

    out.push({
      name: rel.split("/").pop() || "",
      path: rel,
      is_dir: isDir,
      size: sizeM ? Number(sizeM[1].trim()) || 0 : 0,
      modified: modM ? decodeXml(modM[1]).trim() : null,
    });
  }
  return out;
}

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<d:propfind xmlns:d="DAV:"><d:prop>\n' +
  "<d:resourcetype/><d:getcontentlength/><d:getlastmodified/>\n" +
  "</d:prop></d:propfind>";

async function davList({ root, username, password, path: relPath }) {
  const url = joinUrl(root, relPath);
  const res = await request(url, "PROPFIND", {
    username,
    password,
    headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
    body: PROPFIND_BODY,
  });
  if (res.status === 401) throw new Error("认证失败：用户名或密码错误（HTTP 401）");
  if (res.status !== 207 && (res.status < 200 || res.status >= 300)) {
    throw new Error(`WebDAV 返回 HTTP ${res.status}：${url}`);
  }
  return parseMultistatus(res.body.toString("utf8"), root);
}

async function davReadText({ root, username, password, path: relPath }) {
  const url = joinUrl(root, relPath);
  const res = await request(url, "GET", { username, password });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`WebDAV 返回 HTTP ${res.status}：${url}`);
  }
  return res.body.toString("utf8");
}

/**
 * 流式下载，支持断点续传：
 * - 先写 `dest.part`；若已存在则用 Range 续传（服务器支持 206）；
 * - 完成后改名到 `dest`；
 * - 每 200ms 通过 onProgress 上报 { path, downloaded, total }。
 */
function davDownload({ root, username, password, path: relPath, dest }, onProgress) {
  return new Promise((resolve, reject) => {
    const url = joinUrl(root, relPath);
    const u = new URL(url);
    const lib = libFor(url);
    const part = `${dest}.part`;

    let existing = 0;
    try {
      existing = fs.statSync(part).size;
    } catch {
      /* 无断点 */
    }

    const headers = {};
    if (username != null) headers.Authorization = basicAuth(username, password);
    if (existing > 0) headers.Range = `bytes=${existing}-`;

    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "GET",
        headers,
      },
      (res) => {
        const status = res.statusCode;

        if (status === 416) {
          // 已下载完整
          try {
            fs.renameSync(part, dest);
          } catch {
            /* ignore */
          }
          onProgress(dest, existing, existing);
          resolve(existing);
          return;
        }
        if (status < 200 || status >= 300) {
          reject(new Error(`WebDAV 返回 HTTP ${status}：${url}`));
          return;
        }

        const append = existing > 0 && status === 206;
        if (!append) existing = 0;
        const total = res.headers["content-length"]
          ? Number(res.headers["content-length"]) + existing
          : null;

        fs.mkdirSync(nodePath.dirname(dest), { recursive: true });
        const out = fs.createWriteStream(part, { flags: append ? "a" : "w" });
        let downloaded = existing;
        let last = 0;

        res.on("data", (chunk) => {
          downloaded += chunk.length;
          const now = Date.now();
          if (now - last >= 200) {
            onProgress(dest, downloaded, total);
            last = now;
          }
        });
        res.on("error", reject);
        out.on("error", reject);
        out.on("finish", () => {
          out.close(() => {
            try {
              fs.renameSync(part, dest);
            } catch (e) {
              if (!fs.existsSync(dest)) {
                reject(e);
                return;
              }
            }
            onProgress(dest, downloaded, total);
            resolve(downloaded);
          });
        });
        res.pipe(out);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * @param ipcMain Electron ipcMain
 * @param onProgress (dest, downloaded, total) => void
 */
function registerDav(ipcMain, onProgress) {
  ipcMain.handle("dav:list", (_e, args) => davList(args));
  ipcMain.handle("dav:readText", (_e, args) => davReadText(args));
  ipcMain.handle("dav:download", (_e, args) => davDownload(args, onProgress));
}

module.exports = { registerDav };
