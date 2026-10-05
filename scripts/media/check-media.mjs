#!/usr/bin/env node
// 检测资源服务器上某平台的「媒体匹配」情况：
//   - 哪些游戏没匹配到封面
//   - 哪些 media 目录没被任何游戏用到
//   - 哪些 media 目录被多个游戏共用（可能是模糊匹配过宽）
//
// 匹配逻辑与 app/src/domain/scan.ts 一致：
//   games.json 的 media 字段 > 按标题自动匹配（含去掉 mediaVariants 后缀）
//
// 用法：
//   node scripts/media/check-media.mjs PS1
//   node scripts/media/check-media.mjs all
//   node scripts/media/check-media.mjs PS1 --server http://127.0.0.1:5244 --user admin --pass 12345 --mount /EmberHub_Baidu
//
// 报告写到 data/reports/media-report-<平台>.txt（UTF-8，避免控制台乱码）。

import fs from "node:fs";
import { SCRIPT_DEFAULTS, getArg, trimUrl } from "./lib/config.mjs";
import { DEFAULT_MEDIA_VARIANTS, buildVariantRegex, matchMediaDir } from "./lib/media-match.mjs";

const target = process.argv[2];
if (!target || target.startsWith("--")) {
  console.error("用法: node scripts/media/check-media.mjs <平台|all> [--server URL] [--user U] [--pass P] [--mount /path]");
  process.exit(1);
}

const SERVER = trimUrl(getArg("--server", SCRIPT_DEFAULTS.server));
const USER = getArg("--user", SCRIPT_DEFAULTS.user);
const PASS = getArg("--pass", SCRIPT_DEFAULTS.pass);
const MOUNT = trimUrl(getArg("--mount", SCRIPT_DEFAULTS.mount));
const ROMS_DIR = SCRIPT_DEFAULTS.romsDir;

// 以下由 manifest.json 覆盖
let MEDIA_DIR = "media";
let GAMES_FILE = "games.json";

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

// 媒体匹配算法（normalizeKey / buildVariantRegex / matchMediaDir）见 ./lib/media-match.mjs

// ---------- 检测单个平台 ----------
async function checkPlatform(platform, variantRe) {
  const baseRel = `${ROMS_DIR}/${platform}`;
  const baseAbs = `${MOUNT}/${baseRel}`;

  let games = [];
  try {
    games = JSON.parse(await readText(`${baseAbs}/${GAMES_FILE}`)).games ?? [];
  } catch (e) {
    return { platform, error: `读取 games.json 失败: ${e.message}` };
  }

  const media = await listDirs(`${baseAbs}/${MEDIA_DIR}`);
  const index = new Map(media.map((n) => [n.toLowerCase(), n]));

  const used = new Map();
  const unmatched = [];
  for (const g of games) {
    const file = `${baseRel}/${(g.file ?? "").replace(/\\/g, "/")}`;
    const prefix = MEDIA_DIR.toLowerCase() + "/";
    const raw = String(g.media ?? "").replace(/\/+$/, "");
    const dir = raw.toLowerCase().startsWith(prefix) ? raw.slice(prefix.length) : raw;
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
if (manifest.media?.dir) MEDIA_DIR = manifest.media.dir;
if (manifest.files?.games) GAMES_FILE = manifest.files.games;
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

const REPORT_DIR = new URL("../../data/reports/", import.meta.url);
fs.mkdirSync(REPORT_DIR, { recursive: true });
const reportPath = new URL(`media-report-${target}.txt`, REPORT_DIR);
fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
console.log(`报告已写入 data/reports/media-report-${target}.txt`);
