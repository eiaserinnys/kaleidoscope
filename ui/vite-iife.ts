import { build } from "esbuild";
import type { Plugin } from "vite";

export function iife(): Plugin {
  return {
    name: "kaleidoscope-iife",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!source.endsWith("?iife") || !importer) return null;
      const result = await this.resolve(source.slice(0, -5), importer, { skipSelf: true });
      return result ? `${result.id}?iife` : null;
    },
    async load(id) {
      if (!id.endsWith("?iife")) return null;
      const result = await build({ entryPoints: [id.slice(0, -5)], bundle: true, write: false, format: "iife", platform: "browser", target: "es2020" });
      return `export default ${JSON.stringify(result.outputFiles[0].text)};`;
    },
  };
}
