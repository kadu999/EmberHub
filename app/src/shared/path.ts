// 统一的 posix 风格路径工具（前端内部一律用 `/` 分隔）。
// 传给 Rust 的本地路径即使含 `/`，Windows 的 std::fs 也能正确处理。

export function joinPath(...parts: string[]): string {
  const cleaned = parts
    .filter((p): p is string => p != null && p !== "")
    .map((p) => p.replace(/\\/g, "/"));
  if (cleaned.length === 0) return "";
  const head = cleaned[0].replace(/\/+$/, "");
  const rest = cleaned
    .slice(1)
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter((p) => p !== "");
  return [head, ...rest].join("/");
}

export function dirname(p: string): string {
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const i = s.lastIndexOf("/");
  return i <= 0 ? "" : s.slice(0, i);
}

export function basename(p: string): string {
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1).toLowerCase() : "";
}

export function stripExt(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(0, i) : b;
}

export function isAbsolute(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || /^[\\/]/.test(p) || /^[a-z]+:\/\//i.test(p);
}

/** Windows 上部分模拟器（如 PCSX2）不认正斜杠路径，需要转成反斜杠。 */
const IS_WINDOWS = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);
export function nativePath(p: string): string {
  return IS_WINDOWS ? p.replace(/\//g, "\\") : p;
}
