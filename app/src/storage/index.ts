// 存储源工厂：根据配置创建对应的 Provider。
import type { SourceConfig, StorageProvider } from "./types";
import { LocalProvider } from "./providers/local";
import { WebDavProvider } from "./providers/webdav";
import { FtpProvider } from "./providers/ftp";

export function createProvider(source: SourceConfig): StorageProvider {
  switch (source.kind) {
    case "local":
      return new LocalProvider(source.root ?? "");
    case "webdav":
      return new WebDavProvider(
        source.url ?? "",
        source.username ?? "",
        source.password ?? "",
      );
    case "ftp":
      return new FtpProvider(
        source.host ?? "",
        source.port ?? 21,
        source.username ?? "",
        source.password ?? "",
        source.basePath ?? "",
      );
    default: {
      const never: never = source.kind;
      throw new Error(`未知的存储类型: ${never}`);
    }
  }
}

export * from "./types";
