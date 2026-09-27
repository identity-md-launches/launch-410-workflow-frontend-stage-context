import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
export async function startPreview() {
  const root = fileURLToPath(new URL("../../dist/", import.meta.url));
  const server = createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      if (!p.startsWith("/preview/")) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const file = resolve(root, p.slice("/preview/".length) || "index.html");
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, {
        "content-type":
          {
            ".html": "text/html",
            ".json": "application/json",
            ".js": "text/javascript",
            ".css": "text/css",
          }[extname(file)] || "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  await new Promise((r) => server.listen(0, "0.0.0.0", r));
  return {
    url: `http://127.0.0.1:${server.address().port}/preview/`,
    close: () => new Promise((r) => server.close(r)),
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const preview = await startPreview();
  console.log(preview.url);
  const timer = setTimeout(
    async () => {
      await preview.close();
    },
    10 * 60 * 1000,
  );
  process.on("SIGINT", async () => {
    clearTimeout(timer);
    await preview.close();
  });
}
