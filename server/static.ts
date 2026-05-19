import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");

  if (!fs.existsSync(distPath)) {
    // Graceful fallback — do NOT throw here. A hard throw crashes the entire
    // server process on Railway when the frontend build hasn't run yet,
    // which produces a blank/failed deployment with no useful error in logs.
    console.error(
      `[static] WARNING: Build directory not found at ${distPath}. ` +
      `Ensure the build command runs 'vite build' and outputs to dist/public. ` +
      `Serving diagnostic page until a valid build is present.`
    );
    app.use("/{*path}", (_req, res) => {
      res.status(503).send(
        `<!DOCTYPE html><html><head><title>Building...</title></head><body>` +
        `<h2>Frontend build output missing</h2>` +
        `<p>Expected build at: <code>${distPath}</code></p>` +
        `<p>Make sure your Railway build command includes <code>npm run build</code> ` +
        `and that <code>vite.config.ts</code> has <code>build.outDir: 'dist/public'</code>.</p>` +
        `<p>API routes are live. Redeploy with a successful frontend build to restore the UI.</p>` +
        `</body></html>`
      );
    });
    return;
  }

  app.use(express.static(distPath));

  // Fall through to index.html for all non-asset routes (React SPA routing)
  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
