import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dashboardText } from "../shared/dashboard.js";
import { parseContributionCalendar } from "../shared/github-activity.js";

await mkdir("assets", { recursive: true });
await writeFile("dashboard.json", dashboardText(JSON.parse(await readFile("blog/dashboard.json", "utf8"))));
let activity;
try {
  const response = await fetch("https://github.com/users/yt010108/contributions", { headers: { "User-Agent": "yt010108-github-pages", "Accept-Language": "en-US" }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("GitHub response " + response.status);
  activity = parseContributionCalendar(await response.text());
  console.log("Loaded " + activity.days.length + " days of public GitHub contributions");
} catch (error) {
  console.warn("GitHub contributions unavailable: " + error.message);
  activity = { format: "yt010108-github-activity", version: 1, user: "yt010108", available: false, fetchedAt: new Date().toISOString(), days: [] };
}
await writeFile("assets/github-activity.json", JSON.stringify(activity) + "\n");
