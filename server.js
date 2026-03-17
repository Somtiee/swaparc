import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3005;

app.use(express.json());

// Log requests
app.use((req, res, next) => {
  console.log(`[API] ${req.method} ${req.path}`);
  next();
});

// Helper to recursively load API routes
async function registerRoutes(dir, basePath = "/api") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      await registerRoutes(fullPath, `${basePath}/${entry.name}`.replace("//", "/"));
    } else if (entry.name.endsWith(".js")) {
      const routeName = entry.name.replace(".js", "");
      // If basePath ends with /, don't add another one
      const routePath = `${basePath}/${routeName}`.replace("//", "/");
      
      try {
        const module = await import(`file://${fullPath}`);
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

app.listen(PORT, "127.0.0.1", () => {
  console.log(`\n✅ Backend running at http://127.0.0.1:${PORT}`);
  console.log(`   (Vite proxies /api requests here)\n`);
});

// Keep process alive just in case
setInterval(() => {
  // Heartbeat
}, 10000);
