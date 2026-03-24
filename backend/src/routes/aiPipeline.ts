import express, { Request, Response } from 'express';

const router = express.Router();

const AI_SERVER_URL = process.env.AI_SERVER_URL || 'http://127.0.0.1:8000';

async function proxyToAiServer(
  path: string,
  body: unknown
): Promise<{ status: number; payload: any }> {
  const response = await fetch(`${AI_SERVER_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  let payload: any;
  try {
    payload = await response.json();
  } catch {
    payload = { error: 'Invalid JSON response from ai_server.' };
  }

  return { status: response.status, payload };
}

// POST /api/ai/pipeline/start
router.post('/pipeline/start', async (req: Request, res: Response) => {
  try {
    const result = await proxyToAiServer('/pipeline/start', req.body);
    res.status(result.status).json(result.payload);
  } catch (error: any) {
    console.error('AI pipeline start proxy error:', error);
    res.status(500).json({ error: error.message || 'Failed to call ai_server /pipeline/start' });
  }
});

// POST /api/ai/pipeline/answer
router.post('/pipeline/answer', async (req: Request, res: Response) => {
  try {
    const result = await proxyToAiServer('/pipeline/answer', req.body);
    res.status(result.status).json(result.payload);
  } catch (error: any) {
    console.error('AI pipeline answer proxy error:', error);
    res.status(500).json({ error: error.message || 'Failed to call ai_server /pipeline/answer' });
  }
});

// POST /api/ai/pipeline/run-full
router.post('/pipeline/run-full', async (req: Request, res: Response) => {
  try {
    const result = await proxyToAiServer('/pipeline/run-full', req.body);
    res.status(result.status).json(result.payload);
  } catch (error: any) {
    console.error('AI pipeline run-full proxy error:', error);
    res.status(500).json({ error: error.message || 'Failed to call ai_server /pipeline/run-full' });
  }
});

export default router;
