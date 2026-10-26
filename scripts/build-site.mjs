import { readFile, writeFile, mkdir } from "node:fs/promises";
import { publicSite } from "../shared/site.js";
import { createHash } from "node:crypto";
import { validateMedia, verifyImageBytes } from "../shared/media.js";
const media = validateMedia(JSON.parse(await readFile("blog/media.json", "utf8")));
for (const file of media.files) {
  const bytes = await readFile(file.path);
  const sha = createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
  if (file.size !== bytes.length || file.sha !== sha) throw new Error("Media does not match its stored version: " + file.path);
  verifyImageBytes(bytes, file.type);
}
await mkdir("assets", { recursive: true });
const value = publicSite(JSON.parse(await readFile("blog/site.json", "utf8")));
await writeFile("assets/site-data.js", "window.BLOG_SITE_DATA = " + JSON.stringify(value) + ";\n");
console.log("Built site settings: " + value.projects.length + " projects; verified " + media.files.length + " library image(s)");
