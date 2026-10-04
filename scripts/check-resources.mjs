#!/usr/bin/env node
// 检测 / 对齐资源服务器上各平台的 ROM 文件与 games.json：
//   - games.json 引用了、但服务器上没有的文件（启动会 404）
//   - 服务器上有、但 games.json 没引用的文件（孤儿 ROM）
//   - 可自动修复的引用错误（扩展名/命名差异，如 238.iso -> 238.chd）
//
// 用法：
//   node scripts/check-resources.mjs all                    # 只检测，写报告
//   node scripts/check-resources.mjs all --fix              # 修正可修复的引用
//   node scripts/check-resources.mjs all --add              # 收录孤儿 ROM
//   node scripts/check-resources.mjs all --prune            # 移除服务器上不存在的条目
//   node scripts/check-resources.mjs all --reconcile        # = --fix + --add + --prune（完全对齐）
//   node scripts/check-resources.mjs all --server http://127.0.0.1:5244 --user admin --pass 12345 --mount /EmberHub_Baidu
//
// 报告写到 resource-report-<平台>.txt（UTF-8）。
// 任何写操作都会先把原 games.json 备份为 games.json.bak。

import fs from "node:fs";

function getArg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const target = process.argv[2];
if (!target || target.startsWith("--")) {
  console.error(
    "用法: node scripts/check-resources.mjs <平台|all> [--fix|--add|--prune|--reconcile] [--server URL] [--user U] [--pass P] [--mount /path]",
  );
  process.exit(1);
}
const RECONCILE = process.argv.includes("--reconcile");
const FIX = process.argv.includes("--fix") || RECONCILE;
const ADD = process.argv.includes("--add") || RECONCILE;
const PRUNE = process.argv.includes("--prune") || RECONCILE;

const SERVER = getArg("--server", "http://127.0.0.1:5244").replace(/\/+$/, "");
const USER = getArg("--user", "admin");
const PASS = getArg("--pass", "12345");
const MOUNT = getArg("--mount", "/EmberHub_Baidu").replace(/\/+$/, "");

// 视为 ROM 的扩展名
const ROM_EXTS = [
  "zip", "7z", "chd", "iso", "bin", "cue", "img", "ccd", "gcm", "pbp", "m3u",
  "gba", "gbc", "gb", "nds", "3ds", "cia", "cso", "rvz", "wbfs", "wad", "nsp", "xci",
  "n64", "z64", "sfc", "smc", "md", "gen", "nes", "pce", "gg", "sms",
];
// 明确不是 ROM 的文件名片段（贴图/纹理/元数据）
const NON_ROM = /贴图|纹理|metadata|\.txt$|\.json$/i;

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
async function listFiles(path) {
  const j = await api("/api/fs/list", { path, password: "", page: 1, per_page: 2000, refresh: true });
  return (j.data?.content ?? []).filter((e) => !e.is_dir).map((e) => e.name);
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
    .replace(/disc\s*[a-z]/g, "")
    .replace(/disk\s*\d/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

/** 给孤儿 ROM 起标题：数字开头的 PS 游戏借用同号游戏的标题 */
function titleFor(name, games) {
  const base = name.replace(/\.[^.]+$/, "");
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

// ---------- 处理单个平台 ----------
async function processPlatform(platform) {
  const baseRel = `Roms/${platform}`;
  const baseAbs = `${MOUNT}/${baseRel}`;

  const gamesJsonText = await readText(`${baseAbs}/games.json`);
  const gamesJson = JSON.parse(gamesJsonText);
  const games = gamesJson.games ?? [];
  const files = await listFiles(baseAbs);
  const fileSet = new Set(files.map((f) => f.toLowerCase()));

  const missing = [];
  for (const g of games) {
    const f = baseName(g.file);
    if (!fileSet.has(f.toLowerCase())) missing.push({ game: g, file: f });
  }
  const referenced = new Set(games.map((g) => baseName(g.file).toLowerCase()));
  const orphans = files.filter(
    (f) => !referenced.has(f.toLowerCase()) && !/^games\.json$/i.test(f) && !/^media-map\.json$/i.test(f),
  );

  // 近似修复：缺失文件 ↔ 孤儿（扩展名不同等）
  const orphanByNorm = new Map();
  for (const o of orphans) {
    const k = normFile(o);
    if (!orphanByNorm.has(k)) orphanByNorm.set(k, []);
    orphanByNorm.get(k).push(o);
  }
  const fixes = [];
  const trulyMissing = [];
  const fixedOrphans = new Set();
  for (const m of missing) {
    const cand = (orphanByNorm.get(normFile(m.file)) ?? []).find((o) => isRom(o));
    if (cand) {
      fixes.push({ from: m.file, to: cand });
      fixedOrphans.add(cand);
    } else {
      trulyMissing.push(m.file);
    }
  }

  // 剩余可收录的孤儿 ROM
  const toAdd = orphans.filter((o) => isRom(o) && !fixedOrphans.has(o));

  const result = {
    platform,
    games: games.length,
    files: files.length,
    fixes,
    trulyMissing,
    toAdd,
    removed: 0,
    added: 0,
    changed: false,
  };

  if (FIX && (fixes.length || (PRUNE && trulyMissing.length) || (ADD && toAdd.length))) {
    await writeText(`${baseAbs}/games.json.bak`, gamesJsonText);

    // 1) 修正引用
    for (const fx of fixes) {
      for (const g of games) {
        if (baseName(g.file).toLowerCase() === fx.from.toLowerCase()) g.file = fx.to;
      }
    }

    // 2) 移除服务器上不存在的条目
    let kept = games;
    if (PRUNE) {
      kept = games.filter((g) => fileSet.has(baseName(g.file).toLowerCase()));
      result.removed = games.length - kept.length;
    }

    // 3) 收录孤儿 ROM
    if (ADD) {
      const existingTitles = new Set(kept.map((g) => g.title));
      for (const name of toAdd) {
        const title = titleFor(name, kept);
        if (existingTitles.has(title)) continue;
        existingTitles.add(title);
        kept.push({ title, file: name });
        result.added++;
      }
    }

    gamesJson.games = kept;
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
  lines.push(`游戏数: ${r.games} | 服务器文件数: ${r.files}`);
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

const reportPath = `resource-report-${target}.txt`;
fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
console.log(`报告已写入 ${reportPath}`);
