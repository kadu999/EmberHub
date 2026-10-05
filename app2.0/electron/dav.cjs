// Electron 主进程：WebDAV（PROPFIND / GET）。
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

function request(urlStr, method, { username, password, headers, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === "https:" ? https : http;
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
    if (username != null) {
      const token = Buffer.from(`${username}:${password ?? ""}`).toString("base64");
      req.setHeader("Authorization", `Basic ${token}`);
    }
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

async function davDownload({ root, username, password, path: relPath, dest }) {
  const url = joinUrl(root, relPath);
  const res = await request(url, "GET", { username, password });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`WebDAV 返回 HTTP ${res.status}：${url}`);
  }
  await fs.promises.mkdir(nodePath.dirname(dest), { recursive: true });
  await fs.promises.writeFile(dest, res.body);
  return res.body.length;
}

function registerDav(ipcMain) {
  ipcMain.handle("dav:list", (_e, args) => davList(args));
  ipcMain.handle("dav:readText", (_e, args) => davReadText(args));
  ipcMain.handle("dav:download", (_e, args) => davDownload(args));
}

module.exports = { registerDav };
