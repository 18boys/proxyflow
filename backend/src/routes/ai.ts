import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../auth';
import { getDb } from '../db';
import { getPublicAiSettings, getResolvedAiConfig, streamAiText } from '../aiProvider';

const router = Router();

function setSseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
}

function sendSseError(res: Response, message: string, code?: string): void {
  setSseHeaders(res);
  res.write(`data: ${JSON.stringify({ type: 'error', message, code })}\n\n`);
  res.end();
}

async function runAi(
  userId: number,
  res: Response,
  prompt: string,
  maxTokens: number,
): Promise<void> {
  const config = getResolvedAiConfig(userId);
  if (!config) {
    sendSseError(
      res,
      'AI 功能未配置。请前往个人设置配置自己的 AI，或由管理员设置系统默认 AI。',
      'AI_NOT_CONFIGURED',
    );
    return;
  }

  setSseHeaders(res);
  try {
    const fullText = await streamAiText(config, prompt, maxTokens, (text) => {
      res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
    });
    res.write(`data: ${JSON.stringify({ type: 'done', fullText })}\n\n`);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown AI error',
    })}\n\n`);
    res.end();
  }
}

// POST /api/ai/generate-mock - generate mock scenarios from description
router.post('/generate-mock', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { description, url, method } = req.body;
  if (!description) {
    res.status(400).json({ error: 'description is required' });
    return;
  }

  const prompt = `You are an API mock data generator. Generate 3-5 realistic mock response scenarios for the following API endpoint.

Endpoint: ${method || 'GET'} ${url || '/api/example'}
Description: ${description}

Return a JSON array of mock scenarios. Each scenario must have:
- name: descriptive name (e.g., "Success", "Not Found", "Validation Error", "Empty List")
- response_status: HTTP status code (number)
- response_headers: object with Content-Type and any relevant headers
- response_body: valid JSON string representing the response body

IMPORTANT: Return ONLY valid JSON, no markdown, no explanation. Format:
[
  {
    "name": "Success",
    "response_status": 200,
    "response_headers": {"Content-Type": "application/json"},
    "response_body": "{\"data\": {...}}"
  }
]`;

  await runAi(req.userId!, res, prompt, 2000);
});

// POST /api/ai/diagnose - diagnose anomalous requests
router.post('/diagnose', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { requestIds } = req.body;
  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    res.status(400).json({ error: 'requestIds array is required' });
    return;
  }

  const db = getDb();
  const logs = requestIds.map((id: number) => db.prepare(
    'SELECT * FROM request_logs WHERE id = ? AND (user_id = ? OR user_id IS NULL)'
  ).get(id, req.userId!)).filter(Boolean) as Record<string, unknown>[];

  if (logs.length === 0) {
    res.status(404).json({ error: 'No request logs found' });
    return;
  }

  const requestSummaries = logs.map((log) => ({
    method: log['method'],
    url: log['url'],
    status: log['response_status'],
    duration_ms: log['duration_ms'],
    request_body: log['request_body'] ? (() => {
      try { return JSON.parse(log['request_body'] as string); } catch { return log['request_body']; }
    })() : null,
    response_body: log['response_body'] ? (() => {
      try { return JSON.parse(log['response_body'] as string); } catch { return log['response_body']; }
    })() : null,
  }));

  const prompt = `You are an expert API debugging assistant. Analyze these HTTP requests and provide a detailed diagnosis.

Requests to analyze:
${JSON.stringify(requestSummaries, null, 2)}

Please provide:
1. **Root Cause Analysis**: What is the likely cause of these errors/issues?
2. **Error Pattern**: Identify any patterns across these requests
3. **Fix Recommendations**: Specific actionable steps to resolve the issue
4. **Prevention**: How to prevent similar issues in the future

Be specific, technical, and actionable. Format your response with clear markdown headings.`;

  await runAi(req.userId!, res, prompt, 2000);
});

// POST /api/ai/generate-json - natural language to JSON
router.post('/generate-json', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { description, context } = req.body;
  if (!description) {
    res.status(400).json({ error: 'description is required' });
    return;
  }

  const prompt = `Generate a realistic JSON response body based on this description: "${description}"
${context ? `\nContext about the API: ${context}` : ''}

Return ONLY valid JSON, no explanation, no markdown fences. The JSON should be realistic and complete.`;

  await runAi(req.userId!, res, prompt, 1500);
});

// GET /api/ai/status - check effective personal/system configuration
router.get('/status', requireAuth, (req: AuthRequest, res: Response): void => {
  const settings = getPublicAiSettings(req.userId!);
  res.json({
    configured: settings.effective_source !== 'none',
    source: settings.effective_source,
    protocol: settings.effective_source === 'personal' ? settings.protocol : 'anthropic',
    model: settings.effective_source === 'personal' ? settings.model : process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
    message: settings.effective_source !== 'none'
      ? 'AI is ready'
      : 'AI 功能未配置，请前往个人设置配置 AI',
  });
});

export default router;
