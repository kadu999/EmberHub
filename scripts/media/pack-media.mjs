#!/usr/bin/env node
// 把「天马/Pegasus 风格」的媒体包（按类型平铺：covers/ marquees/ videos/ …）
// 整理成 EmberHub 的结构：<输出目录>/<游戏名>/{boxFront,logo,video}.<ext>
//
// 用法：
//   node scripts/media/pack-media.mjs <源目录> <输出目录>
//
// 例：
//   node scripts/media/pack-media.mjs "D:\天马媒体包\downloaded_media\nds" "D:\天马媒体包\nds-media"
//   # 之后把 <输出目录> 里的所有 <游戏名>/ 文件夹上传到 Roms/<平台>/media/

import fs from "node:fs";
import path from "node:path";

// 源类型目录名 → EmberHub 里的规范文件名
const TYPE_MAP = {
  covers: "boxFront",
  cover: "boxFront",
  boxart: "boxFront",
  boxarts: "boxFront",
  boxart_front: "boxFront",
  box_front: "boxFront",
  front: "boxFront",
  marquees: "logo",
  marquee: "logo",
  logos: "logo",
  logo: "logo",
  videos: "video",
  video: "video",
  screenshots: "screenshot",
  screenshot: "screenshot",
};

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error("用法: node scripts/media/pack-media.mjs <源目录> <输出目录>");
  process.exit(1);
}
if (!fs.existsSync(src)) {
  console.error("源目录不存在:", src);
  process.exit(1);
}

let total = 0;
const counts = {};
const skipped = [];

for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const canon = TYPE_MAP[entry.name.toLowerCase()];
  if (!canon) {
    skipped.push(entry.name);
    continue;
  }
  const dir = path.join(src, entry.name);
  for (const f of fs.readdirSync(dir)) {
    const ext = path.extname(f);
    if (!ext) continue;
    const name = path.basename(f, ext).trim();
    if (!name) continue;
    const dest = path.join(out, name);
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(dir, f), path.join(dest, canon + ext));
    total++;
    counts[canon] = (counts[canon] ?? 0) + 1;
  }
}

const folders = fs.existsSync(out) ? fs.readdirSync(out, { withFileTypes: true }).filter((e) => e.isDirectory()).length : 0;
console.log(`复制 ${total} 个文件到 ${out}`);
console.log(`游戏目录数: ${folders}`);
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
if (skipped.length) console.log(`未识别的类型目录（跳过）: ${skipped.join(", ")}`);
