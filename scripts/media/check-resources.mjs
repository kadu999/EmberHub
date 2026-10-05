#!/usr/bin/env node
// 检测 / 对齐资源服务器上各平台的 ROM 文件与 games.json：
//   - games.json 引用了、但服务器上没有的文件（启动会 404）
//   - 服务器上有、但 games.json 没引用的文件（孤儿 ROM）
//   - 可自动修复的引用错误（扩展名不同 / 文件在子文件夹里，如 238.iso -> 238.chd）
//
// 支持子文件夹（多盘 / 多卷游戏）：递归列目录（跳过 media/），按文件名匹配。
//
// 用法：
//   node scripts/media/check-resources.mjs all                    # 只检测，写报告
//   node scripts/media/check-resources.mjs all --fix              # 修正可修复的引用
//   node scripts/media/check-resources.mjs all --add              # 收录孤儿 ROM
//   node scripts/media/check-resources.mjs all --prune            # 移除服务器上不存在的条目
//   node scripts/media/check-resources.mjs all --reconcile        # = --fix + --add + --prune（完全对齐）
//   node scripts/media/check-resources.mjs all --server http://127.0.0.1:5244 --user admin --pass 12345 --mount /EmberHub_Baidu
//
// 报告写到 data/reports/resource-report-<平台>.txt（UTF-8）。
// 任何写操作都会先把原 games.json 备份为 games.json.bak。

import fs from "node:fs";
import { SCRIPT_DEFAULTS, getArg, trimUrl } from "./lib/config.mjs";

const target = process.argv[2];
if (!target || target.startsWith("--")) {
  console.error(
    "用法: node scripts/media/check-resources.mjs <平台|all> [--fix|--add|--prune|--reconcile] [--server URL] [--user U] [--pass P] [--mount /path]",
  );
  process.exit(1);
}
const RECONCILE = process.argv.includes("--reconcile");
const FIX = process.argv.includes("--fix") || RECONCILE;
const ADD = process.argv.includes("--add") || RECONCILE;
const PRUNE = process.argv.includes("--prune") || RECONCILE;

const SERVER = trimUrl(getArg("--server", SCRIPT_DEFAULTS.server));
const USER = getArg("--user", SCRIPT_DEFAULTS.user);
const PASS = getArg("--pass", SCRIPT_DEFAULTS.pass);
const MOUNT = trimUrl(getArg("--mount", SCRIPT_DEFAULTS.mount));
const ROMS_DIR = SCRIPT_DEFAULTS.romsDir;

// 视为 ROM 的扩展名
const ROM_EXTS = [
  "zip", "7z", "chd", "iso", "bin", "cue", "img", "ccd", "gcm", "pbp", "m3u", "cdi", "gdi", "nrg",
  "gba", "gbc", "gb", "nds", "3ds", "cia", "cso", "rvz", "wbfs", "wad", "nsp", "xci",
  "n64", "z64", "sfc", "smc", "md", "gen", "nes", "pce", "gg", "sms",
];
// 明确不是 ROM 的文件名片段（贴图/纹理/元数据）
const NON_ROM = /贴图|纹理|metadata|\.txt$|\.json$/i;
// 元数据文件（永远不当作 ROM）
const META_RE = /^(games\.json|games\.json\.bak|media-map\.json|metadata\.pegasus\.txt)$/i;

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

async function api(path, body) {
  const r = await fetch(SERVER + path, { method: "POST", headers: H, body: JSON.stringify(body) });
  return r.json();
}
async function readText(path) {
  const j = await api("/api/fs/get", { path, password: "" });
  if (!j.data?.raw_url) throw new Error(`读取失败: ${path} (${j.message})`);
  return (await fetch(j.data.raw_url)).text();
}
async function writeText(path, text) {
  const r = await fetch(`${SERVER}/api/fs/put`, {
    method: "PUT",
    headers: {
      Authorization: token,
      "File-Path": encodeURIComponent(path),
      "Content-Type": "application/octet-stream",
      "As-Task": "false",
    },
    body: text,
  });
  const j = await r.json();
  if (j.code !== 200) throw new Error(`写入失败: ${path} (${j.message})`);
}
async function listEntries(path) {
  const j = await api("/api/fs/list", { path, password: "", page: 1, per_page: 3000, refresh: true });
  return (j.data?.content ?? []).map((e) => ({ n: e.name, dir: e.is_dir }));
}

/** 递归列出所有文件（相对路径，posix），跳过 media/ 目录。 */
async function listAllFiles(root) {
  const out = [];
  const walk = async (rel, depth) => {
    let entries;
    try {
      entries = await listEntries(rel ? `${root}/${rel}` : root);
    } catch {
      return;
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.n}` : e.n;
      if (e.dir) {
        if (e.n.toLowerCase() === "media") continue;
        if (depth < 3) await walk(childRel, depth + 1);
      } else {
        out.push(childRel);
      }
    }
  };
  await walk("", 0);
  return out;
}

// ---------- 工具 ----------
const baseName = (p) => String(p ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
const extOf = (n) => (n.includes(".") ? n.slice(n.lastIndexOf(".") + 1).toLowerCase() : "");
const isRom = (n) => ROM_EXTS.includes(extOf(n)) && !NON_ROM.test(n);

/** 归一化文件名用于近似匹配：去扩展名/盘号/非字母数字 */
function normFile(s) {
  return s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/disc\s*[a-z0-9]/g, "")
    .replace(/disk\s*\d/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

/** 给新增文件起标题：子目录用「目录名 (+Disc N)」，顶层 PS 编号借用同号游戏标题 */
function titleFor(rel, games) {
  const parts = rel.split("/");
  const file = parts.pop();
  const folder = parts.length ? parts[parts.length - 1] : null;
  const base = file.replace(/\.[^.]+$/, "");

  if (folder) {
    const disc = base.match(/disc\s*(\d+)/i);
    if (disc) return `${folder} (Disc ${disc[1]})`;
    const variant = base.match(/DOS移植版|98移植版|汉化版|英文版|日文版|改版/i);
    const stripped = base.replace(/DOS移植版|98移植版|汉化版|英文版|日文版|改版/gi, "").trim();
    if (variant && !folder.includes(variant[0])) return `${folder} ${variant[0]}`;
    if (stripped && normFile(folder).includes(normFile(stripped))) return folder;
    return `${folder} · ${base}`;
  }

  const m = base.match(/^(\d+)/);
  if (m) {
    const g = games.find((x) => String(x.file ?? "").startsWith(m[1]));
    if (g) {
      const suffix = base.slice(m[1].length).replace(/^[_\-\s]+/, "");
      return suffix ? `${g.title} ${suffix}` : g.title;
    }
  }
  return base;
}

/** 标题去重：已存在则追加 (2) (3)… */
function uniqueTitle(title, used) {
  if (!used.has(title)) {
    used.add(title);
    return title;
  }
  let i = 2;
  while (used.has(`${title} (${i})`)) i++;
  const t = `${title} (${i})`;
  used.add(t);
  return t;
}

// ---------- 处理单个平台 ----------
async function processPlatform(platform) {
  const baseRel = `${ROMS_DIR}/${platform}`;
  const baseAbs = `${MOUNT}/${baseRel}`;

  const gamesJsonText = await readText(`${baseAbs}/games.json`);
  const gamesJson = JSON.parse(gamesJsonText);
  const games = gamesJson.games ?? [];

  const allFiles = await listAllFiles(baseAbs);
  const romFiles = allFiles.filter((f) => !META_RE.test(baseName(f)));

  // 按文件名分组（同名可能出现在多个子目录，如 9 卷）
  const filesByBase = new Map();
  for (const rel of romFiles) {
    const b = baseName(rel).toLowerCase();
    if (!filesByBase.has(b)) filesByBase.set(b, []);
    filesByBase.get(b).push(rel);
  }

  const usedRel = new Set();
  const fixes = [];
  const kept = [];
  const trulyMissing = [];
  for (const g of games) {
    const f = String(g.file).replace(/\\/g, "/");
    const b = baseName(f).toLowerCase();
    const rel = (filesByBase.get(b) ?? []).find((r) => !usedRel.has(r.toLowerCase()));
    if (rel) {
      usedRel.add(rel.toLowerCase());
      if (rel.toLowerCase() !== f.toLowerCase()) fixes.push({ from: f, to: rel });
      kept.push(g);
    } else {
      trulyMissing.push(f);
    }
  }

  // 近似修复：缺失 ↔ 未使用（扩展名不同等）
  const unused = () => romFiles.filter((r) => !usedRel.has(r.toLowerCase()));
  const byNorm = new Map();
  for (const u of unused()) {
    const k = normFile(u);
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push(u);
  }
  const realMissing = [];
  for (const f of trulyMissing) {
    const cand = (byNorm.get(normFile(f)) ?? []).find((o) => !usedRel.has(o.toLowerCase()));
    if (cand) {
      fixes.push({ from: f, to: cand });
      usedRel.add(cand.toLowerCase());
    } else {
      realMissing.push(f);
    }
  }

  const toAdd = unused().filter((r) => isRom(r));

  const result = {
    platform,
    games: games.length,
    files: romFiles.length,
    fixes,
    trulyMissing: realMissing,
    toAdd,
    removed: 0,
    added: 0,
    changed: false,
  };

  if (FIX && (fixes.length || (PRUNE && realMissing.length) || (ADD && toAdd.length))) {
    // 只在没有备份时写备份，保留最早（原始）那份，避免被后续运行覆盖
    const bakPath = `${baseAbs}/games.json.bak`;
    let hasBak = true;
    try {
      await readText(bakPath);
    } catch {
      hasBak = false;
    }
    if (!hasBak) await writeText(bakPath, gamesJsonText);

    const resultGames = PRUNE ? kept : games;
    // 修正引用（按文件名匹配）
    for (const fx of fixes) {
      const fb = baseName(fx.from).toLowerCase();
      for (const g of resultGames) {
        if (baseName(g.file).toLowerCase() === fb) g.file = fx.to;
      }
    }
    result.removed = PRUNE ? games.length - kept.length : 0;

    if (ADD) {
      const usedTitles = new Set(resultGames.map((g) => g.title));
      for (const rel of toAdd) {
        const title = uniqueTitle(titleFor(rel, resultGames), usedTitles);
        resultGames.push({ title, file: rel });
        result.added++;
      }
    }

    gamesJson.games = resultGames;
    await writeText(`${baseAbs}/games.json`, JSON.stringify(gamesJson, null, 2));
    result.changed = true;
  }
  return result;
}

// ---------- 主流程 ----------
const manifest = JSON.parse(await readText(`${MOUNT}/manifest.json`));
const platforms = target === "all" ? manifest.platforms ?? [] : [target];

const lines = [];
for (const platform of platforms) {
  const r = await processPlatform(platform);
  lines.push(`================ ${platform} ================`);
  lines.push(`游戏数: ${r.games} | 服务器 ROM 文件数: ${r.files}`);
  lines.push(`缺失文件（会 404）: ${r.trulyMissing.length}`);
  for (const f of r.trulyMissing) lines.push(`  x ${f}`);
  lines.push(`可修复引用: ${r.fixes.length}`);
  for (const fx of r.fixes) lines.push(`  ~ ${fx.from}  ->  ${fx.to}`);
  lines.push(`可收录的孤儿 ROM: ${r.toAdd.length}`);
  for (const o of r.toAdd) lines.push(`  + ${o}`);
  if (FIX) {
    lines.push(`已写入 games.json: ${r.changed ? "是" : "无改动"}`);
    if (r.changed) lines.push(`  移除 ${r.removed} 条 | 新增 ${r.added} 条`);
  }
  lines.push("");
  console.log(
    `${platform}: 缺失 ${r.trulyMissing.length} | 可修复 ${r.fixes.length} | 可收录 ${r.toAdd.length}` +
      (FIX ? ` [${r.changed ? `已对齐：-${r.removed} +${r.added}` : "无改动"}]` : ""),
  );
}

const REPORT_DIR = new URL("../../data/reports/", import.meta.url);
fs.mkdirSync(REPORT_DIR, { recursive: true });
const reportPath = new URL(`resource-report-${target}.txt`, REPORT_DIR);
fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
console.log(`报告已写入 data/reports/resource-report-${target}.txt`);
