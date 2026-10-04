// Pegasus / 天马G 的 metadata.pegasus.txt → EmberHub 的 games.json
//
// 用法:
//   node scripts/pegasus-to-json.mjs <metadata.pegasus.txt> <平台名> <输出 games.json>
//
// 例:
//   node scripts/pegasus-to-json.mjs "D:\Roms\GBA\metadata.pegasus.txt" "GBA" "D:\Roms\GBA\games.json"

import fs from "node:fs";

function parseEntries(text) {
  const entries = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith("#")) continue;
    if (raw.trim() === "") continue;
    if (/^\s/.test(raw)) {
      if (cur) {
        const v = raw.trim();
        if (v) cur.values.push(v);
      }
      continue;
    }
    const i = raw.indexOf(":");
    if (i < 0) continue;
    const name = raw.slice(0, i).trim().toLowerCase();
    const value = raw.slice(i + 1).trim();
    if (!name) continue;
    cur = { name, values: value ? [value] : [] };
    entries.push(cur);
  }
  return entries;
}

function flow(values) {
  const parts = [];
  for (const v of values) {
    if (v === ".") parts.push("\n\n");
    else parts.push(v.replace(/\\n/g, "\n"));
  }
  return parts.join(" ").trim();
}

function convert(text, platform) {
  const entries = parseEntries(text);
  const games = [];
  let cur = null;
  let platformName;

  for (const e of entries) {
    if (e.name === "collection") {
      platformName = flow(e.values);
      cur = null;
      continue;
    }
    if (e.name === "game") {
      cur = { title: flow(e.values), files: [], developers: [], genres: [] };
      games.push(cur);
      continue;
    }
    if (!cur) continue;
    switch (e.name) {
      case "file":
      case "files":
        cur.files.push(...e.values);
        break;
      case "assets.box_front":
        cur.boxFront = e.values[0] ?? "";
        break;
      case "developer":
      case "developers":
        cur.developers.push(...e.values);
        break;
      case "genre":
      case "genres":
        cur.genres.push(...e.values);
        break;
      case "players":
        cur.players = flow(e.values);
        break;
      case "release":
        cur.release = flow(e.values);
        break;
      case "description":
        cur.description = flow(e.values);
        break;
      default:
        break;
    }
  }

  const outGames = games
    .map((g) => {
      const o = { title: g.title, file: g.files[0] ?? "" };
      if (g.boxFront) {
        const i = g.boxFront.lastIndexOf("/");
        if (i > 0) o.media = g.boxFront.slice(0, i);
      }
      if (g.developers.length) o.developer = g.developers.join(", ");
      if (g.genres.length) o.genre = g.genres.join(", ");
      if (g.players) o.players = /^\d+$/.test(g.players) ? Number(g.players) : g.players;
      if (g.release) o.release = g.release;
      if (g.description) o.description = g.description;
      return o;
    })
    .filter((g) => g.file);

  return { platform, name: platformName || platform, games: outGames };
}

const [metaPath, platform, outPath] = process.argv.slice(2);
if (!metaPath || !platform || !outPath) {
  console.error("用法: node scripts/pegasus-to-json.mjs <metadata.pegasus.txt> <平台名> <输出 games.json>");
  process.exit(1);
}

const text = fs.readFileSync(metaPath, "utf8");
const data = convert(text, platform);
fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");
console.log(`${platform}: ${data.games.length} 个游戏 -> ${outPath}`);
