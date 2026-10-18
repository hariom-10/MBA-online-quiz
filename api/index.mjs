import { handleApi } from '../server.mjs';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  try {
    const ok = await handleApi(req, res);
    if (!ok) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API route not found' }));
    }
  } catch (error) {
    console.error('[api/index] Handler error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error', message: error.message }));
  }
}
