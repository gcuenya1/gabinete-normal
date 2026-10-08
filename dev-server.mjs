// Servidor local para probar sin Netlify: guarda los datos en ./.data
// Uso: IT_PASSWORD=algo npm run local   →  http://localhost:8888
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
process.env.LOCAL_DATA_DIR ||= path.resolve(".data");
process.env.IT_PASSWORD ||= "admin123";
const { default: api } = await import("./netlify/functions/api.mjs");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await api(new Request(url.href.replace("http://localhost", "http://localhost:8888"), {
      method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
    }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let f = path.join("public", url.pathname === "/" ? "index.html" : url.pathname);
  if (!fs.existsSync(f) && fs.existsSync(f + ".html")) f += ".html";
  if (!fs.existsSync(f)) { res.writeHead(404); res.end("404"); return; }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(process.env.PORT || 8888, () => console.log("Local: http://localhost:" + (process.env.PORT || 8888) + "  (Admin IT: it / " + process.env.IT_PASSWORD + ")"));
