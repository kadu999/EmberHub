// 游戏标题 → media 目录的模糊匹配。
// 从 scan.ts 拆出，保持扫描主流程清晰。

/** 默认的媒体变体后缀（可在 manifest.json 的 mediaVariants 里覆盖）。 */
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
export function normalizeKey(s: string): string {
  return s
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[·・．。:：]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 由变体后缀列表生成匹配正则（长的优先，避免短后缀抢先匹配）。 */
export function buildVariantRegex(variants: string[]): RegExp | null {
  const esc = variants
    .filter((v) => v && v.trim() !== "")
    .map((v) => v.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  if (esc.length === 0) return null;
  return new RegExp(`\\s*(${esc.join("|")})\\s*$`, "i");
}

/** 逐层剥掉变体后缀，返回所有中间形态（如「恶魔城X 平衡版 HACK」→「恶魔城X 平衡版」「恶魔城X」）。 */
function stripVariantSuffixes(s: string, re: RegExp | null): string[] {
  if (!re) return [];
  const out: string[] = [];
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
export function matchMediaDir(
  index: Map<string, string>,
  candidates: string[],
  variantRe: RegExp | null,
): string | undefined {
  // 展开变体：去掉后缀的基础名也参与匹配，让 HACK 等变体复用基础版封面
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

  let best: string | undefined;
  let bestLen = 0;

  // 前缀匹配（标题带后缀、文件夹是基础名，或反之），取最长
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

  // 包含匹配（更宽松）
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

  // 词元重叠匹配（处理「…迷宫战记1+2 汉化版」vs「…迷宫战记 汉化版」这类）
  let bestScore = 0;
  let bestName: string | undefined;
  for (const [key, name] of index) {
    const kt = normalizeKey(key).split(" ").filter(Boolean);
    if (kt.length === 0) continue;
    for (const n of norm) {
      const nt = n.split(" ").filter(Boolean);
      if (nt.length === 0) continue;
      let ov = 0;
      for (const a of kt) {
        if (nt.some((b) => a === b || a.startsWith(b) || b.startsWith(a))) ov++;
      }
      const score = ov / Math.max(kt.length, nt.length);
      if (ov >= 2 && score > bestScore) {
        bestScore = score;
        bestName = name;
      }
    }
  }
  if (bestName && bestScore >= 0.6) return bestName;

  return undefined;
}
