// 存储源工厂：目前只支持 OpenList（WebDAV）。
import { openlistDavUrl } from "./types";
import type { SourceConfig, StorageProvider } from "./types";
import { WebDavProvider } from "./providers/webdav";

export function createProvider(source: SourceConfig): StorageProvider {
  return new WebDavProvider(
    openlistDavUrl(source),
    source.username ?? "",
    source.password ?? "",
  );
}

export * from "./types";
