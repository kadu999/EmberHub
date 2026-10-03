// Pegasus / 天马G 元数据解析器。
// 格式参考：https://pegasus-frontend.org/docs/dev/meta-syntax
//
// 规则：
//   - `#` 开头为注释；空行忽略
//   - 以非空白字符开头的行是 `name: value`，定义一个新 entry（键名大小写不敏感）
//   - 以空白开头的行是上一个 entry 的续接值
//   - 所有 entry 归属「最近定义的 collection 或 game」

export interface PegasusEntry {
  name: string;
  values: string[];
}

export interface PegasusGame {
  title: string;
  sortTitle?: string;
  files: string[];
  developers: string[];
  publishers: string[];
  genres: string[];
  tags: string[];
  players?: string;
  release?: string;
  rating?: number;
  summary?: string;
  description?: string;
  launch?: string;
  workdir?: string;
  assets: Record<string, string>;
}

export interface PegasusCollection {
  name: string;
  shortname?: string;
  launch?: string;
  workdir?: string;
  summary?: string;
  description?: string;
  extensions: string[];
  files: string[];
  regex: string[];
  assets: Record<string, string>;
  games: PegasusGame[];
}

/** 把文件切成 entry 列表。 */
export function parsePegasusEntries(text: string): PegasusEntry[] {
  const entries: PegasusEntry[] = [];
  let current: PegasusEntry | null = null;

  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith("#")) continue;
    if (raw.trim() === "") continue;

    if (/^\s/.test(raw)) {
      // 续接值
      const v = raw.trim();
      if (v !== "" && current) current.values.push(v);
      continue;
    }

    const idx = raw.indexOf(":");
    if (idx < 0) continue;
    const name = raw.slice(0, idx).trim().toLowerCase();
    if (name === "") continue;
    const value = raw.slice(idx + 1).trim();
    current = { name, values: value !== "" ? [value] : [] };
    entries.push(current);
  }

  return entries;
}

/** 声明式文本：`.` 为段落分隔，`\n` 为换行，其余按空格拼接。 */
export function flowText(values: string[]): string {
  const parts: string[] = [];
  for (const v of values) {
    if (v === ".") {
      parts.push("\n\n");
    } else {
      parts.push(v.replace(/\\n/g, "\n"));
    }
  }
  return parts.join(" ").trim();
}

function parseRating(v: string): number | undefined {
  const t = v.trim();
  if (t === "") return undefined;
  if (t.endsWith("%")) {
    const n = parseFloat(t.slice(0, -1));
    return Number.isFinite(n) ? n / 100 : undefined;
  }
  const n = parseFloat(t);
  if (!Number.isFinite(n)) return undefined;
  return n > 1 ? n / 100 : n;
}

function toList(values: string[]): string[] {
  return values.map((v) => v.trim()).filter((v) => v !== "");
}

function splitComma(values: string[]): string[] {
  return values
    .flatMap((v) => v.split(","))
    .map((v) => v.trim().replace(/^\./, ""))
    .filter((v) => v !== "");
}

function applyAsset(target: { assets: Record<string, string> }, key: string, values: string[]) {
  const assetName = key.slice("assets.".length);
  if (assetName && values[0]) target.assets[assetName] = values[0].trim();
}

/** 解析整个元数据文件，返回集合列表（含各自游戏）。 */
export function parsePegasus(text: string): PegasusCollection[] {
  const entries = parsePegasusEntries(text);
  const collections: PegasusCollection[] = [];
  const byName = new Map<string, PegasusCollection>();

  let currentCollection: PegasusCollection | null = null;
  let currentGame: PegasusGame | null = null;

  const newCollection = (name: string): PegasusCollection => {
    const c: PegasusCollection = {
      name,
      extensions: [],
      files: [],
      regex: [],
      assets: {},
      games: [],
    };
    collections.push(c);
    byName.set(name.toLowerCase(), c);
    return c;
  };

  for (const entry of entries) {
    const key = entry.name;

    if (key === "collection") {
      const name = flowText(entry.values);
      if (name === "") continue;
      const found = byName.get(name.toLowerCase());
      currentCollection = found ?? newCollection(name);
      currentGame = null;
      continue;
    }

    if (key === "game") {
      const title = flowText(entry.values);
      if (title === "" || !currentCollection) continue;
      currentGame = {
        title,
        files: [],
        developers: [],
        publishers: [],
        genres: [],
        tags: [],
        assets: {},
      };
      currentCollection.games.push(currentGame);
      continue;
    }

    const target = currentGame ?? currentCollection;
    if (!target) continue;

    if (key.startsWith("assets.")) {
      applyAsset(target, key, entry.values);
      continue;
    }

    // ---- 通用字段 ----
    switch (key) {
      case "launch":
      case "command":
        target.launch = flowText(entry.values);
        break;
      case "workdir":
      case "cwd":
        target.workdir = flowText(entry.values);
        break;
      case "summary":
        target.summary = flowText(entry.values);
        break;
      case "description":
        target.description = flowText(entry.values);
        break;
      case "sort-by":
      case "sort_title":
      case "sort_name":
        if (currentGame) currentGame.sortTitle = flowText(entry.values);
        break;
      case "shortname":
        if (isCollection(target)) target.shortname = flowText(entry.values);
        break;
      case "file":
      case "files":
        target.files.push(...toList(entry.values));
        break;
      case "extension":
      case "extensions":
        if (isCollection(target)) target.extensions.push(...splitComma(entry.values));
        break;
      case "regex":
        if (isCollection(target)) target.regex.push(...toList(entry.values));
        break;
      default:
        // 仅游戏字段
        if (currentGame) applyGameField(currentGame, key, entry.values);
        break;
    }
  }

  return collections;
}

function isCollection(
  t: PegasusGame | PegasusCollection,
): t is PegasusCollection {
  return Array.isArray((t as PegasusCollection).extensions);
}

function applyGameField(game: PegasusGame, key: string, values: string[]) {
  switch (key) {
    case "developer":
    case "developers":
      game.developers.push(...toList(values));
      break;
    case "publisher":
    case "publishers":
      game.publishers.push(...toList(values));
      break;
    case "genre":
    case "genres":
      game.genres.push(...toList(values));
      break;
    case "tag":
    case "tags":
      game.tags.push(...toList(values));
      break;
    case "players":
      game.players = flowText(values);
      break;
    case "release":
      game.release = flowText(values);
      break;
    case "rating":
      game.rating = parseRating(flowText(values));
      break;
    default:
      break;
  }
}
