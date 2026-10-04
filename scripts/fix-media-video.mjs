#!/usr/bin/env node
// 检测媒体包里的视频编码，把 WebView2 不支持的编码（如 MPEG-4 Part 2 / mp4v）
// 转成 H.264 后替换回服务器。
//
// 用法：
//   node scripts/fix-media-video.mjs SS DC                 # 只检测，列出来
//   node scripts/fix-media-video.mjs SS DC --apply         # 转码并上传替换
//   node scripts/fix-media-video.mjs SS --limit 20         # 只处理前 20 个
//   node scripts/fix-media-video.mjs SS --ffmpeg <path> --ffprobe <path>
//
// 需要 ffmpeg / ffprobe（默认走 PATH）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { SCRIPT_DEFAULTS, getArg, trimUrl } from "./lib/config.mjs";
import { DEFAULT_MEDIA_VARIANTS, buildVariantRegex, matchMediaDir } from "./lib/media-match.mjs";

const VALUE_FLAGS = ["--ffmpeg", "--ffprobe", "--limit", "--server", "--user", "--pass", "--mount"];
const positional = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    if (VALUE_FLAGS.includes(a)) i++;
    continue;
  }
  positional.push(a);
}

const APPLY = process.argv.includes("--apply");
const FFMPEG = getArg("--ffmpeg", SCRIPT_DEFAULTS.ffmpeg);
const FFPROBE = getArg("--ffprobe", SCRIPT_DEFAULTS.ffprobe);
const LIMIT = Number(getArg("--limit", "0")) || 0;
const SERVER = trimUrl(getArg("--server", SCRIPT_DEFAULTS.server));
const USER = getArg("--user", SCRIPT_DEFAULTS.user);
const PASS = getArg("--pass", SCRIPT_DEFAULTS.pass);
const MOUNT = trimUrl(getArg("--mount", SCRIPT_DEFAULTS.mount));
const ROMS_DIR = SCRIPT_DEFAULTS.romsDir;

// 视频扩展名可被 manifest.json 的 media.video.exts 覆盖（下面读取 manifest 后设置）
let VIDEO_EXTS = ["mp4", "webm", "mkv", "avi", "mov", "m4v"];
// WebView2 能播的编码（这里比对的是 MP4 里的 fourcc）
const GOOD_CODECS = new Set(["avc1", "hvc1", "hev1", "av01", "vp09"]);

if (positional.length === 0) {
  console.error("用法: node scripts/fix-media-video.mjs <平台...> [--apply] [--limit N] [--ffmpeg PATH] [--ffprobe PATH]");
  process.exit(1);
}

// ---------- OpenList API ----------
const login = await (await fetch(`${SERVER}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: USER, password: PASS }),
})).json();
if (login.code !== 200) {
  console.error("OpenList 登录失败:", login.message);
  process.exit(1);
}
const token = login.data.token;
const H = { Authorization: token, "Content-Type": "application/json" };

async function api(p, body) {
  const r = await fetch(SERVER + p, { method: "POST", headers: H, body: JSON.stringify(body) });
  return r.json();
}
async function listEntries(p) {
  const j = await api("/api/fs/list", { path: p, password: "", page: 1, per_page: 3000, refresh: true });
  return (j.data?.content ?? []).map((e) => ({ n: e.name, dir: e.is_dir, size: e.size }));
}
async function upload(p, buf) {
  const r = await fetch(SERVER + "/api/fs/put", {
    method: "PUT",
    headers: { ...H, "File-Path": encodeURIComponent(p), "Content-Type": "application/octet-stream", "As-Task": "false" },
    body: buf,
  });
  const j = await r.json();
  if (j.code !== 200) throw new Error(`上传失败: ${p} (${j.message})`);
}
const davUrl = (rel) => `${SERVER}/dav${MOUNT}/${rel.split("/").map(encodeURIComponent).join("/")}`;
const AUTH_HEADER = { Authorization: "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64") };

/** 抓头/尾片段找编码 fourcc（Range 请求，比 ffprobe 拉整个文件快很多）。 */
async function detectCodec(rel, size) {
  const codes = ["avc1", "hvc1", "hev1", "av01", "vp09", "mp4v"];
  const scan = async (range) => {
    try {
      const r = await fetch(davUrl(rel), { headers: { ...AUTH_HEADER, Range: range } });
      if (!r.ok && r.status !== 206) return null;
      const s = Buffer.from(await r.arrayBuffer()).toString("latin1");
      for (const c of codes) if (s.includes(c)) return c;
    } catch {
      /* 忽略，继续下一个 */
    }
    return null;
  };
  const head = await scan("bytes=0-262143");
  if (head) return head;
  if (size && size > 262144) {
    const tail = await scan(`bytes=${Math.max(0, size - 307200)}-${size - 1}`);
    if (tail) return tail;
  }
  return "(unknown)";
}

// 媒体匹配算法（normalizeKey / buildVariantRegex / matchMediaDir）见 ./lib/media-match.mjs

/** 某平台 games.json 里游戏实际用到的 media 目录集合；读不到 games.json 返回 null（= 不限制）。 */
async function usedMediaDirs(platform, index, variantRe) {
  let games;
  try {
    const d = await api("/api/fs/get", { path: `${MOUNT}/${ROMS_DIR}/${platform}/${GAMES_FILE}`, password: "" });
    if (!d.data?.raw_url) return null;
    games = JSON.parse(await (await fetch(d.data.raw_url)).text()).games ?? [];
  } catch {
    return null;
  }
  const used = new Set();
  for (const g of games) {
    const prefix = MEDIA_DIR.toLowerCase() + "/";
    const raw = String(g.media ?? "").replace(/\/+$/, "");
    const explicit = raw.toLowerCase().startsWith(prefix) ? raw.slice(prefix.length) : raw;
    let hit = explicit ? index.get(explicit.toLowerCase()) : undefined;
    if (!hit) {
      const file = String(g.file ?? "").replace(/\\/g, "/");
      const candidates = [String(g.title ?? "")];
      const b = file.split("/").pop() ?? "";
      candidates.push(b.replace(/\.[^.]+$/, ""));
      const first = file.split("/")[0];
      if (first && first !== file) candidates.push(first);
      hit = matchMediaDir(index, candidates, variantRe);
    }
    if (hit) used.add(hit);
  }
  return used;
}

// ---------- 处理 ----------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fix-media-"));
let checked = 0;
let badCount = 0;
const bad = [];

// manifest 约定（mediaVariants / 视频扩展名 / 媒体目录名 / games 文件名）
let mediaVariants = DEFAULT_MEDIA_VARIANTS;
let MEDIA_DIR = "media";
let GAMES_FILE = "games.json";
try {
  const d = await api("/api/fs/get", { path: `${MOUNT}/manifest.json`, password: "" });
  if (d.data?.raw_url) {
    const m = JSON.parse(await (await fetch(d.data.raw_url)).text());
    mediaVariants = m.mediaVariants ?? DEFAULT_MEDIA_VARIANTS;
    if (Array.isArray(m.media?.video?.exts) && m.media.video.exts.length > 0) {
      VIDEO_EXTS = m.media.video.exts;
    }
    if (m.media?.dir) MEDIA_DIR = m.media.dir;
    if (m.files?.games) GAMES_FILE = m.files.games;
  }
} catch {
  /* 忽略 */
}
const variantRe = buildVariantRegex(mediaVariants);

for (const platform of positional) {
  const mediaRoot = `${ROMS_DIR}/${platform}/${MEDIA_DIR}`;
  let allDirs;
  try {
    allDirs = (await listEntries(`${MOUNT}/${mediaRoot}`)).filter((e) => e.dir).map((e) => e.n);
  } catch {
    console.log(`${platform}: 没有 media 目录`);
    continue;
  }
  // 只处理 games.json 里游戏实际用到的 media 目录
  const index = new Map(allDirs.map((n) => [n.toLowerCase(), n]));
  const used = await usedMediaDirs(platform, index, variantRe);
  const dirs = used ? allDirs.filter((d) => used.has(d)) : allDirs;
  console.log(`${platform}: media 共 ${allDirs.length} 个，游戏用到 ${dirs.length} 个`);
  for (const d of dirs) {
    const files = await listEntries(`${MOUNT}/${mediaRoot}/${d}`);
    const vid = files.find((f) => !f.dir && VIDEO_EXTS.includes(f.n.split(".").pop().toLowerCase()));
    if (!vid) continue;
    if (LIMIT && checked >= LIMIT) break;
    checked++;
    const rel = `${mediaRoot}/${d}/${vid.n}`;
    const codec = await detectCodec(rel, vid.size);
    if (codec && !GOOD_CODECS.has(codec)) {
      badCount++;
      bad.push({ rel, codec });
      console.log(`  x ${rel}  [${codec}]`);
      if (APPLY) {
        const inFile = path.join(tmpDir, "in" + path.extname(rel));
        const outFile = path.join(tmpDir, "out.mp4");
        const buf = Buffer.from(await (await fetch(davUrl(rel), {
          headers: { Authorization: "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64") },
        })).arrayBuffer());
        fs.writeFileSync(inFile, buf);
        execFileSync(FFMPEG, [
          "-y", "-i", inFile, "-c:v", "libx264", "-crf", "23", "-preset", "veryfast",
          "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", outFile,
        ], { stdio: "ignore" });
        // 换成 .mp4（原文件可能不是 mp4 容器）
        const target = rel.replace(/\.[^.]+$/, ".mp4");
        await upload(`${MOUNT}/${target}`, fs.readFileSync(outFile));
        if (target !== rel) {
          await api("/api/fs/remove", { dir: `${MOUNT}/${mediaRoot}/${d}`, names: [vid.n] });
        }
        console.log(`    -> 已转码上传 ${target}`);
      }
    }
  }
}

console.log("");
console.log(`共检查 ${checked} 个视频，其中 ${badCount} 个编码不被 WebView2 支持${APPLY ? "（已转码替换）" : "（加 --apply 才会转码）"}`);
fs.rmSync(tmpDir, { recursive: true, force: true });
