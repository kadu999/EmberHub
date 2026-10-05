// 媒体目录匹配算法（Node 脚本共用）。
// 与 app/src/domain/media-match.ts 保持同一套规则：
//   games.json 的 media 字段 > 按标题自动匹配（会先去掉 mediaVariants 后缀）

/** 媒体变体后缀（可在 manifest.json 的 mediaVariants 覆盖）。 */
export const DEFAULT_MEDIA_VARIANTS = [
  "部分汉化版",
  "汉化贴图",
  "复刻限定版",
  "汉化版",
  "英文版",
  "日文版",
  "震动版",
  "平衡版",
  "RIP版",
  "重制版",
  "导剪版",
  "改版",
  "HACK",
];

/** 归一化标题：去掉 [..]、(..)、常见分隔符，压缩空白并转小写。 */
export function normalizeKey(s) {
  return s
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[·・．。:：]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 由变体后缀列表生成匹配正则（长的优先，避免短后缀抢先匹配）。 */
export function buildVariantRegex(variants) {
  const esc = variants
    .filter((v) => v && v.trim() !== "")
    .map((v) => v.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  return esc.length ? new RegExp(`\\s*(${esc.join("|")})\\s*$`, "i") : null;
}

/** 逐层剥掉变体后缀，返回所有中间形态。 */
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

/** 在 media 索引（小写目录名 → 实际目录名）里为游戏找匹配目录：精确 → 规整 → 前缀 → 包含 → 词元重叠。 */
export function matchMediaDir(index, candidates, variantRe) {
  const expanded = new Set(candidates);
  for (const c of candidates) for (const s of stripVariantSuffixes(c, variantRe)) expanded.add(s);
  candidates = [...expanded];

  const raw = candidates.map((c) => c.toLowerCase()).filter((c) => c !== "");
  for (const c of raw) {
    const hit = index.get(c);
    if (hit) return hit;
  }

  const norm = [...new Set(candidates.map(normalizeKey).filter((s) => s.length >= 2))];
  for (const n of norm) {
    const hit = index.get(n);
    if (hit) return hit;
  }

  let best;
  let bestLen = 0;

  for (const [key, name] of index) {
    const k = normalizeKey(key);
    if (k.length < 3) continue;
    for (const n of norm) {
      if (n.length < 3) continue;
      if (n.startsWith(k) || k.startsWith(n)) {
        const len = Math.min(k.length, n.length);
        if (len > bestLen) {
          best = name;
          bestLen = len;
        }
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
        if (len > bestLen) {
          best = name;
          bestLen = len;
        }
      }
    }
  }
  if (best) return best;

  let bestScore = 0;
  let bestName;
  for (const [key, name] of index) {
    const kt = normalizeKey(key).split(" ").filter(Boolean);
    if (kt.length === 0) continue;
    for (const n of norm) {
      const nt = n.split(" ").filter(Boolean);
      if (nt.length === 0) continue;
      let ov = 0;
      for (const a of kt) if (nt.some((b) => a === b || a.startsWith(b) || b.startsWith(a))) ov++;
      const score = ov / Math.max(kt.length, nt.length);
      if (ov >= 2 && score > bestScore) {
        bestScore = score;
        bestName = name;
      }
    }
  }
  return bestName && bestScore >= 0.6 ? bestName : undefined;
}
