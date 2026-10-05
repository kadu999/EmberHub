// 轻量日志：同时写 stderr 与 <下载目录>/logs/emberhub.log。
const fs = require("node:fs");
const nodePath = require("node:path");

let logFile = "";

function initLog(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    logFile = nodePath.join(dir, "emberhub.log");
  } catch {
    logFile = "";
  }
}

function logLine(level, tag, message) {
  const line = `${new Date().toISOString()} ${level} [${tag}] ${message}\n`;
  process.stderr.write(line);
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, line);
  } catch {
    /* ignore */
  }
}

module.exports = {
  initLog,
  logFile: () => logFile,
  logInfo: (tag, message) => logLine("INFO", tag, message),
  logError: (tag, message) => logLine("ERROR", tag, message),
};
