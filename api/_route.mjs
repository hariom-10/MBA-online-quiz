import { handleApi } from "../server/api/router.mjs";

/** Vercel Node function adapter. Each public route has its own entrypoint so
 * Vercel discovers it without depending on a catch-all rewrite. */
export function apiRoute(pathname) {
  return async function handler(req, res) {
    // Explicitly restore the endpoint path: serverless rewrites may expose the
    // function filename in req.url instead of the incoming path.
    req.url = pathname;
    try {
      const handled = await handleApi(req, res);
      if (!handled && !res.writableEnded) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "API route not found" }));
      }
    } catch (error) {
      console.error("[api] Handler error:", error);
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "Internal Server Error" }));
      }
    }
  };
}
