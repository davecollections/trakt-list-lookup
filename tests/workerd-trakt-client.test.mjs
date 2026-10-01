import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, resolve, join, relative, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Pure runtime unit test. Only the transport is replaced; workerd constructs the
// actual client's Request. No external service data, real secret or network call.
const root = fileURLToPath(new URL("../", import.meta.url));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli && basename(npmCli) === "npm-cli.js", "Run with npm run test:workerd");
const temp = await mkdtemp(join(tmpdir(), "dingo-trakt-runtime-"));
const config = await readFile(join(root, "wrangler.dingo.toml"), "utf8");
const compatibilityDate = config.match(/^compatibility_date = "([^"]+)"/m)?.[1];
assert.ok(compatibilityDate);
const client = join(root, "functions/lib/trakt-client.js").replaceAll("\\", "/");
const source = `
import { traktFetch } from ${JSON.stringify(client)};
function require(value, message) { if (!value) throw new Error(message); }
export default { async fetch() {
  const original = globalThis.fetch;
  let cases = 0;
  try {
    for (const strict of [false, true]) {
      for (const status of [200, 301, 302, 307, 308, 404, 429]) {
        const requests = [], statuses = [];
        globalThis.fetch = async (input, init) => {
          const request = new Request(input, init);
          require(request.redirect === "manual", "Runtime redirect mode");
          require(new URL(request.url).origin === "https://api.trakt.tv", "Fixed origin");
          require(request.headers.get("trakt-api-key") === "unit-placeholder", "Unit header");
          requests.push(request);
          return new Response(status === 200 ? "[]" : null, {status, headers:{
            "Content-Type":"application/json", "Location":"https://redirect.invalid/unit",
            "Retry-After":"12"
          }});
        };
        let failure, payload;
        try {
          payload = await traktFetch("/lists/popular", "unit-placeholder", {
            strict, quietStatuses:[404,429], accounting:{run:dispatch=>dispatch()},
            onResponse:status=>statuses.push(status)
          });
        } catch (error) { failure = error; }
        require(requests.length === 1, "Single request with no redirect follow or retry");
        require(statuses.length === 1 && statuses[0] === status, "Observed HTTP status");
        if (status === 200) require(!failure && Array.isArray(payload.data), "2xx regression");
        else {
          require(failure?.status === (status < 400 ? 502 : status), "Failure mapping");
          require(!failure.message.includes("redirect.invalid"), "Sanitized target");
          if (status === 429) require(failure.retryAfter === "12", "Retry-After regression");
        }
        cases++;
      }
    }
    return Response.json({passed:true,cases,outboundTraktGets:0});
  } catch (error) {
    return Response.json({passed:false,message:error.message}, {status:500});
  } finally { globalThis.fetch = original; }
} };
`;
let child, output = "", timeout;
try {
  await writeFile(join(temp, "worker.mjs"), source);
  await writeFile(join(temp, "wrangler.json"), JSON.stringify({
    name: "dingo-trakt-runtime-unit", main: "worker.mjs",
    compatibility_date: compatibilityDate, workers_dev: false, preview_urls: false, routes: [],
  }));
  // Do not let local shell credentials or the repository's .dev.vars enter this test.
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" };
  for (const key of Object.keys(env)) {
    if (/^(TRAKT_|TMDB_|CLOUDFLARE_|CF_API_)/i.test(key)) delete env[key];
  }
  child = spawn(process.execPath, [join(dirname(npmCli), "npx-cli.js"), "--yes", "wrangler@4.145.0",
    "dev", "--local", "--config", join(temp, "wrangler.json"), "--ip", "127.0.0.1",
    "--port", "0", "--inspector-port", "0", "--show-interactive-dev-session=false"], {
    cwd: temp, env, windowsHide: true, detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await new Promise((accept, reject) => {
    timeout = setTimeout(() => reject(new Error("Local workerd startup timed out")), 60000);
    const receive = chunk => {
      output = (output + chunk.toString()).slice(-12000);
      const match = output.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) accept(match[1]);
    };
    child.stdout.on("data", receive);
    child.stderr.on("data", receive);
    child.once("error", reject);
    child.once("exit", code => reject(new Error("Local workerd exited: " + code)));
  });
  clearTimeout(timeout);
  const result = await fetch(url, {signal: AbortSignal.timeout(15000)});
  const body = await result.json();
  assert.equal(result.status, 200, JSON.stringify(body));
  assert.deepEqual(body, {passed:true,cases:14,outboundTraktGets:0});
  console.log("workerd Trakt client: 14 pure runtime cases passed; zero outbound Trakt GETs");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  clearTimeout(timeout);
  if (child?.pid && child.exitCode === null) {
    const exited = once(child, "exit");
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {windowsHide:true, stdio:"ignore"});
    } else process.kill(-child.pid, "SIGTERM");
    await exited;
  }
  // temp is created here, verified inside the OS temp directory before removal.
  const inside = relative(resolve(tmpdir()), resolve(temp));
  assert.ok(inside && !inside.startsWith("..") && basename(temp).startsWith("dingo-trakt-runtime-"));
  await rm(temp, {recursive:true,force:true,maxRetries:10,retryDelay:100});
}
