#!/usr/bin/env node
// 检测资源服务器上某平台的「媒体匹配」情况：
//   - 哪些游戏没匹配到封面
//   - 哪些 media 目录没被任何游戏用到
//   - 哪些 media 目录被多个游戏共用（可能是模糊匹配过宽）
//
// 匹配逻辑与 app/src/library/scan.ts 一致：
//   games.json 的 media 字段 > 按标题自动匹配（含去掉 mediaVariants 后缀）
//
// 用法：
//   node scripts/check-media.mjs PS1
//   node scripts/check-media.mjs all
//   node scripts/check-media.mjs PS1 --server http://127.0.0.1:5244 --user admin --pass 12345 --mount /EmberHub_Baidu
//
// 报告写到 media-report-<平台>.txt（UTF-8，避免控制台乱码）。

import fs from "node:fs";

function getArg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const target = process.argv[2];
if (!target || target.startsWith("--")) {
  console.error("用法: node scripts/check-media.mjs <平台|all> [--server URL] [--user U] [--pass P] [--mount /path]");
  process.exit(1);
}

const SERVER = getArg("--server", "http://127.0.0.1:5244").replace(/\/+$/, "");
const USER = getArg("--user", "admin");
const PASS = getArg("--pass", "12345");
const MOUNT = getArg("--mount", "/EmberHub_Baidu").replace(/\/+$/, "");

const DEFAULT_MEDIA_VARIANTS = [
  "部分汉化版", "汉化贴图", "复刻限定版", "汉化版", "英文版", "日文版",
  "震动版", "平衡版", "RIP版", "重制版", "导剪版", "改版", "HACK",
];

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
async function listDirs(path) {
  const j = await api("/api/fs/list", { path, password: "", page: 1, per_page: 1000, refresh: true });
  return (j.data?.content ?? []).filter((e) => e.is_dir).map((e) => e.name);
}

// ---------- 与 scan.ts 一致的匹配逻辑 ----------
function normalizeKey(s) {
  return s
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[·・．。:：]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildVariantRegex(variants) {
  const esc = variants
    .filter((v) => v && v.trim() !== "")
    .map((v) => v.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  return esc.length ? new RegExp(`\\s*(${esc.join("|")})\\s*$`, "i") : null;
}

function stripVariantSuffixes(s, re) {
  if (!re) return [];
  const out = [];
  let cur = s.trim();
  for (let i = 0; i < 3; i++) {
    const next = cur.replace(re, "").trim();
    if (!next || next === cur) break;
    out.push(next);
    cur = next;
  }
  return out;
}

function matchMediaDir(index, candidates, variantRe) {
  const expanded = new Set(candidates);
  for (const c of candidates) for (const s of stripVariantSuffixes(c, variantRe)) expanded.add(s);
  candidates = [...expanded];

  const raw = candidates.map((c) => c.toLowerCase()).filter((c) => c !== "");
  for (const c of raw) { const hit = index.get(c); if (hit) return hit; }

  const norm = [...new Set(candidates.map(normalizeKey).filter((s) => s.length >= 2))];
  for (const n of norm) { const hit = index.get(n); if (hit) return hit; }

  let best, bestLen = 0;
  for (const [key, name] of index) {
    const k = normalizeKey(key);
    if (k.length < 3) continue;
    for (const n of norm) {
      if (n.length < 3) continue;
      if (n.startsWith(k) || k.startsWith(n)) {
        const len = Math.min(k.length, n.length);
        if (len > bestLen) { best = name; bestLen = len; }
      }
    }
  }
  if (best) return best;

  for (const [key, name] of index) {
    const k = normalizeKey(key);
    if (k.length < 5) continue;
    for (const n of norm) {
      if (n.length < 5) continue;
      if (n.includes(k) || k.includes(n)) {
        const len = Math.min(k.length, n.length);
        if (len > bestLen) { best = name; bestLen = len; }
      }
    }
  }
  if (best) return best;

  let bestScore = 0, bestName;
  for (const [key, name] of index) {
    const kt = normalizeKey(key).split(" ").filter(Boolean);
    if (kt.length === 0) continue;
    for (const n of norm) {
      const nt = n.split(" ").filter(Boolean);
      if (nt.length === 0) continue;
      let ov = 0;
      for (const a of kt) if (nt.some((b) => a === b || a.startsWith(b) || b.startsWith(a))) ov++;
      const score = ov / Math.max(kt.length, nt.length);
      if (ov >= 2 && score > bestScore) { bestScore = score; bestName = name; }
    }
  }
  if (bestName && bestScore >= 0.6) return bestName;
  return undefined;
}

// ---------- 检测单个平台 ----------
async function checkPlatform(platform, variantRe) {
  const baseRel = `Roms/${platform}`;
  const baseAbs = `${MOUNT}/${baseRel}`;

  let games = [];
  try {
    games = JSON.parse(await readText(`${baseAbs}/games.json`)).games ?? [];
  } catch (e) {
    return { platform, error: `读取 games.json 失败: ${e.message}` };
  }

  const media = await listDirs(`${baseAbs}/media`);
  const index = new Map(media.map((n) => [n.toLowerCase(), n]));

  const used = new Map();
  const unmatched = [];
  for (const g of games) {
    const file = `${baseRel}/${(g.file ?? "").replace(/\\/g, "/")}`;
    const explicit = g.media ?? "";
    const dir = explicit.replace(/^media\//i, "").replace(/\/+$/, "");
    let matched = dir ? index.get(dir.toLowerCase()) : undefined;
    if (!matched) {
      const candidates = [g.title];
      const b = file.split("/").pop() ?? "";
      candidates.push(b.replace(/\.[^.]+$/, ""));
      const first = file.split("/")[0];
      if (first && first !== file) candidates.push(first);
      matched = matchMediaDir(index, candidates, variantRe);
    }
    if (matched) {
      if (!used.has(matched)) used.set(matched, []);
      used.get(matched).push(g.title);
    } else {
      unmatched.push(g.title);
    }
  }

  const unused = media.filter((m) => !used.has(m));
  const shared = [...used].filter(([, v]) => v.length > 1);
  return { platform, games: games.length, media: media.length, unmatched, unused, shared };
}

// ---------- 主流程 ----------
const manifest = JSON.parse(await readText(`${MOUNT}/manifest.json`));
const variants = Array.isArray(manifest.mediaVariants) ? manifest.mediaVariants : DEFAULT_MEDIA_VARIANTS;
const variantRe = buildVariantRegex(variants);
const platforms = target === "all" ? manifest.platforms ?? [] : [target];

const lines = [];
for (const platform of platforms) {
  const r = await checkPlatform(platform, variantRe);
  lines.push(`================ ${platform} ================`);
  if (r.error) {
    lines.push(`  ${r.error}`);
    lines.push("");
    continue;
  }
  lines.push(`游戏数: ${r.games} | media 目录数: ${r.media}`);
  lines.push(`未匹配到媒体的游戏: ${r.unmatched.length}`);
  for (const t of r.unmatched) lines.push(`  x ${t}`);
  lines.push(`没有任何游戏用到的 media 目录: ${r.unused.length}`);
  for (const m of r.unused) lines.push(`  · ${m}`);
  lines.push(`被多个游戏共用的 media 目录: ${r.shared.length}`);
  for (const [k, v] of r.shared) lines.push(`  ${k}  <-  ${v.join(" / ")}`);
  lines.push("");
  console.log(`${platform}: 未匹配 ${r.unmatched.length} | 未使用 media ${r.unused.length} | 共用 ${r.shared.length}`);
}

const reportPath = `media-report-${target}.txt`;
fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
console.log(`报告已写入 ${reportPath}`);
