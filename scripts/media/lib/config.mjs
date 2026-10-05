// Node 脚本共用的默认参数与参数读取。
// 默认值可在 scripts/media/config.json 覆盖（server / user / pass / mount / romsDir），
// 也可继续用命令行参数覆盖。
import fs from "node:fs";

const BUILTIN = {
  server: "http://127.0.0.1:5244",
  user: "admin",
  pass: "12345",
  mount: "/EmberHub_Baidu",
  romsDir: "Roms",
  ffmpeg: "ffmpeg",
  ffprobe: "ffprobe",
};

let fileCfg = {};
try {
  fileCfg = JSON.parse(fs.readFileSync(new URL("../config.json", import.meta.url), "utf8"));
} catch {
  // 没有 config.json 就用内置默认
}

export const SCRIPT_DEFAULTS = { ...BUILTIN, ...fileCfg };

/** 读取命令行参数值，缺省返回 def。 */
export function getArg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/** 解析并去掉结尾斜杠的 OpenList 地址 / 挂载路径。 */
export function trimUrl(v) {
  return String(v ?? "").replace(/\/+$/, "");
}
