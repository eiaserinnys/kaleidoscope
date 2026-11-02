import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
      const result = await build({
        entryPoints: [id.slice(0, -5)], bundle: true, write: false, format: "iife", platform: "browser", target: "es2020",
        plugins: [{ name: "inline-css", setup(bundler) {
          bundler.onResolve({ filter: /\.css\?raw$/ }, (args) => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: "inline-css" }));
          bundler.onLoad({ filter: /.*/, namespace: "inline-css" }, async (args) => ({ contents: `export default ${JSON.stringify(await readFile(args.path, "utf8"))}`, loader: "js" }));
        } }],
      });
      return `export default ${JSON.stringify(result.outputFiles[0].text)};`;
    },
  };
}
