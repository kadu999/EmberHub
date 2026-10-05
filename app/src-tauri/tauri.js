#!/usr/bin/env node
// Tauri Android 的已知问题绕过（tauri-apps/tauri #9536、#13892）：
// Gradle 的 rust 任务会执行 `node tauri android android-studio-script ...`，
// 其工作目录是 src-tauri，Node 无法把裸标识符 `tauri` 解析成 npm 包，于是报
// "Cannot find module ...\src-tauri\tauri"。
// 本文件让 Node 把 `tauri` 解析到这里，再转发到本地安装的 @tauri-apps/cli。
// 注意：app/package.json 是 "type": "module"，故本文件按 ESM 处理，用 createRequire。
// 正常桌面开发不受影响（只有这个调用路径会用到它）。
import { createRequire } from "node:module";
createRequire(import.meta.url)("../node_modules/@tauri-apps/cli/tauri.js");
