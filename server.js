import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 3000);
const token = process.env.GITHUB_TOKEN;
const mimeTypes = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (request.method === "GET" && url.pathname === "/api/github") return handleGithub(url.searchParams.get("username"), response);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  try {
    const content = await readFile(join(root, "public", pathname));
    response.writeHead(200, { "Content-Type": mimeTypes[extname(pathname)] || "text/plain; charset=utf-8" });
    response.end(content);
  } catch { response.writeHead(404).end("Not found"); }
});

server.listen(port, () => console.log(`GitHub Wrapped running at http://localhost:${port}`));

async function github(path) {
  const result = await fetch(`https://api.github.com${path}`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "github-wrapped-demo", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!result.ok) { const error = new Error(`GitHub returned ${result.status}`); error.status = result.status; throw error; }
  return result.json();
}

async function handleGithub(username, response) {
  if (!username?.trim()) return sendJson(response, 400, { error: "Enter a GitHub username." });
  try {
    const user = await github(`/users/${encodeURIComponent(username.trim())}`);
    const repos = [];
    for (let page = 1; page <= 3 && repos.length < Math.min(user.public_repos || 0, 100); page += 1) {
      const batch = await github(`/users/${encodeURIComponent(user.login)}/repos?per_page=100&page=${page}&sort=pushed`);
      repos.push(...batch.filter((repo) => !repo.fork));
      if (batch.length < 100) break;
    }
    return sendJson(response, 200, normalize(user, repos));
  } catch (error) {
    const message = error.status === 404 ? "GitHub couldn't find that human." : error.status === 403 ? "GitHub is rate-limiting this reveal. Try again in a minute." : "GitHub is having a tiny existential crisis. Try again.";
    return sendJson(response, error.status === 404 ? 404 : 502, { error: message });
  }
}

function normalize(user, repos) {
  const now = Date.now();
  const languages = {};
  repos.forEach((repo) => { if (repo.language) languages[repo.language] = (languages[repo.language] || 0) + 1; });
  const sorted = [...repos].sort((a, b) => b.stargazers_count - a.stargazers_count);
  const inactive = repos.filter((repo) => now - new Date(repo.pushed_at || repo.updated_at).getTime() > 1000 * 60 * 60 * 24 * 180).sort((a, b) => new Date(a.pushed_at || a.updated_at) - new Date(b.pushed_at || b.updated_at));
  const ageDays = (date) => Math.max(0, Math.floor((now - new Date(date).getTime()) / 86400000));
  const nameText = repos.map((repo) => repo.name.toLowerCase()).join(" ");
  const finalCount = (nameText.match(/final|temp|test|v2|new/g) || []).length;
  const totalStars = repos.reduce((sum, repo) => sum + repo.stargazers_count, 0);
  const totalForks = repos.reduce((sum, repo) => sum + repo.forks_count, 0);
  const languageList = Object.entries(languages).sort((a, b) => b[1] - a[1]);
  const redFlagScore = Math.min(100, Math.round((inactive.length / Math.max(repos.length, 1)) * 55 + finalCount * 8 + (totalStars === 0 && repos.length > 2 ? 12 : 0)));
  const aura = Math.min(99, Math.max(1, Math.round(Math.min(repos.length, 30) / 30 * 25 + Math.min(totalStars, 100) / 100 * 20 + Math.min(totalForks, 50) / 50 * 15 + Math.min(languageList.length, 5) / 5 * 10 + (inactive.length ? 7 : 15) + (user.followers > 10 ? 10 : user.followers))));
  const topRepo = sorted[0];
  const archetype = inactive.length > repos.length * .55 ? "THE PROJECT HOPPER" : finalCount >= 2 ? "THE PANIC DEBUGGER" : languageList.length >= 5 ? "THE OPEN-SOURCE GOBLIN" : totalStars > 20 ? "THE SILENT BUILDER" : repos.length <= 3 ? "THE CONSISTENT BUILDER" : "THE MIDNIGHT ARCHITECT";
  return { user: { login: user.login, name: user.name, avatar: user.avatar_url, bio: user.bio, followers: user.followers, following: user.following, created: user.created_at }, repositories: repos.map((repo) => ({ name: repo.name, description: repo.description, stars: repo.stargazers_count, forks: repo.forks_count, language: repo.language, created: repo.created_at, updated: repo.updated_at, pushed: repo.pushed_at, topics: repo.topics || [] })), analytics: { repoCount: repos.length, totalStars, totalForks, languages: languageList, topLanguage: languageList[0]?.[0] || null, topRepo: topRepo?.name || null, topRepoStars: topRepo?.stargazers_count || 0, oldestRepo: repos.length ? repos.reduce((a, b) => new Date(a.created_at) < new Date(b.created_at) ? a : b).name : null, inactive: inactive.slice(0, 5).map((repo) => ({ name: repo.name, days: ageDays(repo.pushed_at || repo.updated_at), date: repo.pushed_at || repo.updated_at })), redFlagScore, aura, archetype, finalCount, activeDays: repos.filter((repo) => ageDays(repo.pushed_at || repo.updated_at) < 90).length } };
}

function sendJson(response, status, data) { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); response.end(JSON.stringify(data)); }
