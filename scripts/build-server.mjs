import { build } from "esbuild";
import { copyFile } from "node:fs/promises";
await build({
  entryPoints: ["server/index.ts"],
  outfile: "dist-server/index.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
});
await copyFile("server/file-parser.mjs", "dist-server/file-parser.mjs");
