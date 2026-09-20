/**
 * npm run serve:output
 *
 * Serves `.vercel/output` over HTTP the way Vercel will: static files first,
 * `/api/*` dispatched to the built function bundles, everything else falling
 * back to the SPA shell.
 *
 * This is the closest thing to the real deployment that can be run on a
 * laptop, and unlike `vercel dev` it needs no account, no login and no
 * project link. It exists so that "does the deployed API work?" is a question
 * that can be answered before deploying rather than after.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, ".vercel", "output");
const staticDir = join(output, "static");
const require = createRequire(import.meta.url);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

type Handler = (req: unknown, res: unknown) => unknown;

const handlers = new Map<string, Handler>();

function handlerFor(name: string): Handler | undefined {
  if (handlers.has(name)) return handlers.get(name);
  const path = join(output, "functions/api", `${name}.func/index.js`);
  if (!existsSync(path)) return undefined;
  const loaded = require(path) as { default?: Handler } | Handler;
  const handler = typeof loaded === "function" ? loaded : loaded.default;
  if (handler) handlers.set(name, handler);
  return handler;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** The subset of the Vercel response helpers our handlers actually use. */
function vercelResponse(res: ServerResponse) {
  let status = 200;
  const headers: Record<string, string> = {};
  return {
    status(code: number) {
      status = code;
      return this;
    },
    setHeader(key: string, value: string) {
      headers[key] = value;
      return this;
    },
    json(body: unknown) {
      res.writeHead(status, {
        ...headers,
        "content-type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(body));
      return this;
    },
  };
}

function serveStatic(res: ServerResponse, filePath: string): boolean {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
  res.writeHead(200, {
    "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
  });
  createReadStream(filePath).pipe(res);
  return true;
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = normalize(decodeURIComponent(url.pathname));

    // 1. Functions.
    if (pathname.startsWith("/api/")) {
      const name = pathname.slice("/api/".length).replace(/\/$/, "");
      const handler = handlerFor(name);
      if (!handler) {
        // Matches the Build Output API routing: an unknown /api path is a
        // JSON 404, never the HTML shell.
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: `No function ${name}.` } }));
        return;
      }
      try {
        await handler(
          {
            method: req.method,
            headers: req.headers,
            body: await readBody(req),
          },
          vercelResponse(res),
        );
      } catch (error) {
        // A crash here is the production bug reproducing locally, so make it
        // loud rather than letting it become a mystery 500.
        console.error(`\n!! ${pathname} threw:`, error);
        res.writeHead(500, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              category: "INTERNAL_GAME_ERROR",
              message: error instanceof Error ? error.message : String(error),
            },
          }),
        );
      }
      return;
    }

    // 2. Static files.
    if (serveStatic(res, join(staticDir, pathname))) return;

    // 3. SPA fallback.
    if (serveStatic(res, join(staticDir, "index.html"))) return;

    res.writeHead(404).end("Not found");
  })();
});

if (!existsSync(output)) {
  console.error(
    "No .vercel/output found. Run `npm run build` first — it writes the deployment output.",
  );
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3210);
server.listen(port, () => {
  console.log(`Serving the built deployment on http://localhost:${port}`);
  console.log("  static    .vercel/output/static");
  console.log("  functions /api/decide, /api/config");
  console.log("\nThis is what Vercel will serve. Ctrl+C to stop.");
});
