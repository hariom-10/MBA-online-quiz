import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "api-server-middleware",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.startsWith("/api/")) {
            try {
              // @ts-expect-error router.mjs is JS without declarations
              const { handleApi } = await import("./server/api/router.mjs");
              if (await handleApi(req, res)) return;
            } catch (err) {
              console.error("[vite-api-middleware] Error handling API request:", err);
            }
          }
          next();
        });
      },
    },
  ],
});
