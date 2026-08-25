import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { config } from "dotenv";

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3005);
const HOST = String(process.env.API_HOST || "127.0.0.1").trim() || "127.0.0.1";
const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";

app.set("trust proxy", 1);
app.use(express.json({ limit: "4mb" }));

const extraOrigins = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const allowOrigins = new Set([
  "https://swaparc.app",
  "https://www.swaparc.app",
  "http://127.0.0.1:3000",
  "https://127.0.0.1:3000",
  ...extraOrigins,
]);

app.use((req, res, next) => {
  const origin = String(req.headers.origin || "").trim();
  const allowed =
    origin &&
    (allowOrigins.has(origin) || /\.vercel\.app$/i.test(origin));
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Wallet-Signature, X-Auth-Timestamp, X-Auth-Nonce, X-Wallet-Address, X-User-Token"
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
  }
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

if (!isProd) {
  app.use((req, res, next) => {
    console.log(`[API] ${req.method} ${req.path}`);
    next();
  });
}

async function registerRoutes(dir, basePath = "/api") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await registerRoutes(fullPath, `${basePath}/${entry.name}`.replace("//", "/"));
    } else if (entry.name.endsWith(".js")) {
      const routeName = entry.name.replace(".js", "");
      const routePath = `${basePath}/${routeName}`.replace("//", "/");

      try {
        const module = await import(pathToFileURL(fullPath).href);
        if (module.default) {
          console.log(`   Mapped: ${routePath}`);
          app.all(routePath, async (req, res) => {
            try {
              await module.default(req, res);
            } catch (err) {
              console.error(`Error handling ${routePath}:`, err);
              if (!res.headersSent) res.status(500).json({ error: err.message });
            }
          });
        }
      } catch (err) {
        console.error(`Failed to load ${fullPath}:`, err);
      }
    }
  }
}

console.log("Loading API routes...");
const apiRoot = path.join(__dirname, "api");
if (fs.existsSync(apiRoot)) {
  await registerRoutes(apiRoot);
} else {
  console.error("API directory not found!");
}

app.listen(PORT, HOST, () => {
  console.log(`\n✅ Backend running at http://${HOST}:${PORT}`);
  if (!isProd) {
    console.log(`   (Vite proxies /api requests here)\n`);
  }
});
