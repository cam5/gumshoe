#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { RUNS_DIR } from "../test/lib/record-run.js";

const PORT = Number(process.env.PORT ?? 4500);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function annotationsPath(runId) {
  return path.join(RUNS_DIR, runId, "annotations.json");
}

/** Only a real, existing runs/<id>/ directory is a valid runId — rejects path traversal and made-up ids. */
function resolveRunDir(runId) {
  if (!runId || runId.includes("/") || runId.includes("..")) return null;
  const dir = path.join(RUNS_DIR, runId);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  return dir;
}

async function readAnnotations(runId) {
  const file = annotationsPath(runId);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeAnnotations(runId, annotations) {
  await writeFile(annotationsPath(runId), JSON.stringify(annotations, null, 2));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

/** Serves report.html and everything under runs/<id>/ (screenshots, clone.html, prompt.md) at the same relative paths report.html already links with. */
function serveStatic(req, res, pathname) {
  const relative = pathname === "/" ? "report.html" : decodeURIComponent(pathname.slice(1));
  const runsRoot = path.resolve(RUNS_DIR);
  const filePath = path.resolve(runsRoot, relative);
  if (filePath !== runsRoot && !filePath.startsWith(runsRoot + path.sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/api\/annotations\/([^/]+)(?:\/([^/]+))?$/);

    if (match) {
      const [, runId, annotationId] = match;
      if (!resolveRunDir(runId)) return sendJson(res, 404, { error: `Unknown run: ${runId}` });

      if (req.method === "GET") {
        return sendJson(res, 200, await readAnnotations(runId));
      }

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        if (!body.excerpt || !body.note) return sendJson(res, 400, { error: "excerpt and note are both required" });
        const annotations = await readAnnotations(runId);
        const annotation = {
          id: crypto.randomUUID().slice(0, 8),
          section: body.section ? String(body.section).slice(0, 200) : null,
          excerpt: String(body.excerpt).slice(0, 2000),
          note: String(body.note).slice(0, 4000),
          createdAt: new Date().toISOString(),
        };
        annotations.push(annotation);
        await writeAnnotations(runId, annotations);
        return sendJson(res, 201, annotation);
      }

      if (req.method === "DELETE" && annotationId) {
        const annotations = await readAnnotations(runId);
        await writeAnnotations(runId, annotations.filter((a) => a.id !== annotationId));
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 405, { error: "Method not allowed" });
    }

    if (req.method === "GET") return serveStatic(req, res, url.pathname);
    sendJson(res, 405, { error: "Method not allowed" });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Serving ${RUNS_DIR} at http://127.0.0.1:${PORT}`);
  console.log(`Annotations save to runs/<id>/annotations.json — they survive \`npm run report:runs\` rebuilds.`);
});
