import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";

const result = await build({
  entryPoints: ["admin/src/editor.js"], outfile: "admin/assets/editor.js",
  bundle: true, minify: true, format: "iife", target: "es2022",
  legalComments: "external", metafile: true, logLevel: "info"
});

const packages = new Map();
await build({
  entryPoints: ["src/public-posts.js"], outfile: "assets/posts.js",
  bundle: true, minify: true, format: "iife", target: "es2022", logLevel: "info"
});
for (const input of Object.keys(result.metafile.inputs).filter(path => path.includes("node_modules"))) {
  let dir = dirname(resolve(input));
  while (relative(process.cwd(), dir).includes("node_modules")) {
    try {
      const info = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
      if (!info.name) { dir = dirname(dir); continue; }
      if (info.name && !packages.has(info.name)) {
        let license;
        for (const filename of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "license.md"]) {
          try { license = await readFile(join(dir, filename), "utf8"); break; } catch {}
        }
        if (!license) throw new Error("Missing license for " + info.name);
        packages.set(info.name, info.name + " " + info.version + "\n" + license.trim());
      }
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      dir = dirname(dir);
    }
  }
}
const text = [...packages.entries()].sort(([a], [b]) => a.localeCompare(b, "en")).map(([, text]) => text).join("\n\n" + "=".repeat(72) + "\n\n") + "\n";
await writeFile("admin/assets/THIRD-PARTY-LICENSES.txt", text.replaceAll("\r\n", "\n"));
