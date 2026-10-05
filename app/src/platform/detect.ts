// 运行平台探测（同步，基于 WebView 的 UA）。
// 与 shared/path.ts 的 Windows 判断同源，避免两处规则漂移。
export type Os = "windows" | "linux" | "macos" | "android" | "ios" | "unknown";

export function detectOs(): Os {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/windows/i.test(ua)) return "windows";
  if (/mac os x|macintosh/i.test(ua)) return "macos";
  if (/linux/i.test(ua)) return "linux";
  return "unknown";
}
