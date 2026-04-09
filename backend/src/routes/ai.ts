import { Router, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, AuthRequest } from '../auth';
import { getDb } from '../db';

const router = Router();

// Check if API key is configured
function isApiKeyConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim() !== '';
}

// Return SSE-formatted error when AI is not configured
function sendAiUnconfiguredError(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.write(`data: ${JSON.stringify({
    type: 'error',
    message: 'AI 功能未配置：请在后端 .env 文件中设置 ANTHROPIC_API_KEY。\n\n示例：\nANTHROPIC_API_KEY=sk-ant-api03-...',
    code: 'AI_NOT_CONFIGURED',
  })}\n\n`);
  res.end();
}

// Lazy-init Anthropic client (only when API key is present)
function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

// POST /api/ai/generate-mock - generate mock scenarios from description
router.post('/generate-mock', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!isApiKeyConfigured()) { sendAiUnconfiguredError(res); return; }

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
  },
  ...
]`;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const anthropic = getAnthropicClient();
    const stream = anthropic.messages.stream({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    let fullText = '';

    stream.on('text', (text) => {
      fullText += text;
      res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
    });

    stream.on('finalMessage', () => {
      res.write(`data: ${JSON.stringify({ type: 'done', fullText })}\n\n`);
      res.end();
    });

    stream.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
    res.end();
  }
});

// POST /api/ai/diagnose - diagnose anomalous requests
router.post('/diagnose', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!isApiKeyConfigured()) { sendAiUnconfiguredError(res); return; }

  const { requestIds } = req.body;

  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    res.status(400).json({ error: 'requestIds array is required' });
    return;
  }

  const db = getDb();
  // Match logs by id AND (user_id matches OR user_id is null for anonymous proxy requests)
  const logs = requestIds.map((id: number) => {
    const log = db.prepare('SELECT * FROM request_logs WHERE id = ? AND (user_id = ? OR user_id IS NULL)').get(id, req.userId!);
    return log;
  }).filter(Boolean) as Record<string, unknown>[];

  if (logs.length === 0) {
    res.status(404).json({ error: 'No request logs found' });
    return;
  }

  const requestSummaries = logs.map((log) => ({
    method: log['method'],
    url: log['url'],
    status: log['response_status'],
    duration_ms: log['duration_ms'],
    request_body: log['request_body'] ? JSON.parse(log['request_body'] as string || '{}') : null,
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

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const anthropic = getAnthropicClient();
    const stream = anthropic.messages.stream({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
    });

    stream.on('finalMessage', () => {
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    });

    stream.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
    res.end();
  }
});

// POST /api/ai/generate-json - natural language to JSON
router.post('/generate-json', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!isApiKeyConfigured()) { sendAiUnconfiguredError(res); return; }

  const { description, context } = req.body;

  if (!description) {
    res.status(400).json({ error: 'description is required' });
    return;
  }

  const prompt = `Generate a realistic JSON response body based on this description: "${description}"
${context ? `\nContext about the API: ${context}` : ''}

Return ONLY valid JSON, no explanation, no markdown fences. The JSON should be realistic and complete.`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const anthropic = getAnthropicClient();
    const stream = anthropic.messages.stream({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    let fullText = '';

    stream.on('text', (text) => {
      fullText += text;
      res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
    });

    stream.on('finalMessage', () => {
      res.write(`data: ${JSON.stringify({ type: 'done', fullText })}\n\n`);
      res.end();
    });

    stream.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
    res.end();
  }
});

// GET /api/ai/status - check if AI is configured
router.get('/status', requireAuth, (_req, res: Response): void => {
  res.json({
    configured: isApiKeyConfigured(),
    message: isApiKeyConfigured()
      ? 'AI is ready'
      : 'AI 功能未配置：请在后端 .env 文件中设置 ANTHROPIC_API_KEY',
  });
});

export default router;
