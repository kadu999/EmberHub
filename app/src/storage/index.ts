// 存储源工厂：OpenList（WebDAV）与 HTTP（纯静态服务器）。
import { httpBaseUrl, openlistDavUrl } from "./types";
import type { SourceConfig, StorageProvider } from "./types";
import { WebDavProvider } from "./providers/webdav";
import { HttpProvider } from "./providers/http";

export function createProvider(source: SourceConfig): StorageProvider {
  if (source.kind === "http") {
    return new HttpProvider(httpBaseUrl(source));
  }
  return new WebDavProvider(
    openlistDavUrl(source),
    source.username ?? "",
    source.password ?? "",
  );
}

export * from "./types";
