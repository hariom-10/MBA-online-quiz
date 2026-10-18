import { handleApi } from "../server/api/router.mjs";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  try {
    const handled = await handleApi(req, res);
    if (!handled && !res.writableEnded) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "API route not found" }));
    }
  } catch (error) {
    console.error("[api/[...all]] Handler error:", error);
    if (!res.writableEnded) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Error", message: error.message }));
    }
  }
}
