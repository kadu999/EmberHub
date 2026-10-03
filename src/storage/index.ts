// 存储源工厂：根据配置创建对应的 Provider。
import type { SourceConfig, StorageProvider } from "./types";
import { LocalProvider } from "./providers/local";
import { WebDavProvider } from "./providers/webdav";

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
    default: {
      const never: never = source.kind;
      throw new Error(`未知的存储类型: ${never}`);
    }
  }
}

export * from "./types";
