import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const folder = process.env.SITE_OUTPUT || "_site";
await mkdir(folder + "/admin", { recursive: true });
const revision = process.env.GITHUB_SHA || createHash("sha256").update(await readFile("published.json")).digest("hex").slice(0, 16);
for (const name of ["index.html", "404.html", "styles.css", "app.js", "content.js", "published.json", "published.js", "theme.js", ".nojekyll"]) {
  if (name.endsWith(".html")) await writeFile(folder + "/" + name, (await readFile(name, "utf8")).replaceAll("__BUILD__", revision));
  else await cp(name, folder + "/" + name);
}
await cp("assets", folder + "/assets", { recursive: true });
await cp("admin/assets", folder + "/admin/assets", { recursive: true });
await cp("admin/editor.css", folder + "/admin/editor.css");
await writeFile(folder + "/admin/index.html", (await readFile("admin/index.html", "utf8")).replaceAll("__BUILD__", revision));
await writeFile(folder + "/assets/deployment.json", JSON.stringify({ commit: process.env.GITHUB_SHA || null, builtAt: new Date().toISOString() }) + "\n");
console.log("Prepared static site at " + folder);
