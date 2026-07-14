import Anthropic from '@anthropic-ai/sdk';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { getDb } from './db';

export type AiProtocol = 'openai' | 'anthropic';

export interface AiConfigInput {
  protocol: AiProtocol;
  endpoint: string;
  model: string;
  apiKey: string | null;
}

export interface ResolvedAiConfig extends AiConfigInput {
  source: 'personal' | 'system';
}

export interface PublicAiSettings {
  enabled: boolean;
  protocol: AiProtocol;
  endpoint: string;
  model: string;
  has_api_key: boolean;
  effective_source: 'personal' | 'system' | 'none';
  system_configured: boolean;
}

interface StoredAiSettings {
  enabled: number;
  protocol: string;
  endpoint: string;
  model: string;
  api_key_encrypted: string | null;
}

const DEFAULT_OPENAI_ENDPOINT = 'https://api.openai.com/v1';
const DEFAULT_ANTHROPIC_ENDPOINT = 'https://api.anthropic.com';
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-sonnet-20241022';

function encryptionKey(): Buffer {
  const secret = process.env.AI_CREDENTIAL_SECRET
    || process.env.JWT_SECRET
    || 'proxyflow-secret-key-change-in-production-2024';
  return createHash('sha256').update(secret).digest();
}

export function encryptApiKey(apiKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptApiKey(value: string | null): string | null {
  if (!value) return null;
  const [version, ivValue, tagValue, encryptedValue] = value.split(':');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

export function normalizeAiProtocol(value: unknown): AiProtocol | null {
  return value === 'openai' || value === 'anthropic' ? value : null;
}

export function defaultEndpoint(protocol: AiProtocol): string {
  return protocol === 'anthropic' ? DEFAULT_ANTHROPIC_ENDPOINT : DEFAULT_OPENAI_ENDPOINT;
}

export function validateAiEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getStoredAiSettings(userId: number): StoredAiSettings | undefined {
  return getDb().prepare(
    'SELECT enabled, protocol, endpoint, model, api_key_encrypted FROM user_ai_settings WHERE user_id = ?'
  ).get(userId) as StoredAiSettings | undefined;
}

function getSystemAiConfig(): ResolvedAiConfig | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    source: 'system',
    protocol: 'anthropic',
    endpoint: (process.env.ANTHROPIC_BASE_URL || DEFAULT_ANTHROPIC_ENDPOINT).replace(/\/+$/, ''),
    model: process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
    apiKey,
  };
}

export function getResolvedAiConfig(userId: number): ResolvedAiConfig | null {
  const stored = getStoredAiSettings(userId);
  const protocol = normalizeAiProtocol(stored?.protocol);
  if (stored?.enabled && protocol && stored.endpoint && stored.model) {
    return {
      source: 'personal',
      protocol,
      endpoint: stored.endpoint.replace(/\/+$/, ''),
      model: stored.model,
      apiKey: decryptApiKey(stored.api_key_encrypted),
    };
  }
  return getSystemAiConfig();
}

export function getPublicAiSettings(userId: number): PublicAiSettings {
  const stored = getStoredAiSettings(userId);
  const system = getSystemAiConfig();
  const protocol = normalizeAiProtocol(stored?.protocol) || 'openai';
  const personalReady = Boolean(stored?.enabled && stored.endpoint && stored.model);
  return {
    enabled: Boolean(stored?.enabled),
    protocol,
    endpoint: stored?.endpoint || defaultEndpoint(protocol),
    model: stored?.model || '',
    has_api_key: Boolean(stored?.api_key_encrypted),
    effective_source: personalReady ? 'personal' : system ? 'system' : 'none',
    system_configured: Boolean(system),
  };
}

function openAiChatUrl(endpoint: string): string {
  const normalized = endpoint.replace(/\/+$/, '');
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

function authHeaders(apiKey: string | null): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function streamOpenAiText(
  config: AiConfigInput,
  prompt: string,
  maxTokens: number,
  onChunk: (text: string) => void,
): Promise<string> {
  const response = await fetch(openAiChatUrl(config.endpoint), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(config.apiKey),
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`AI endpoint returned ${response.status}: ${detail.slice(0, 300)}`);
  }
  if (!response.body) throw new Error('AI endpoint returned an empty stream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const data = line.trim().replace(/^data:\s*/, '');
      if (!data || data === '[DONE]') continue;
      try {
        const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        const text = payload.choices?.[0]?.delta?.content;
        if (text) {
          fullText += text;
          onChunk(text);
        }
      } catch {
        // Ignore keep-alive and provider-specific non-JSON lines.
      }
    }
  }

  return fullText;
}

async function streamAnthropicText(
  config: AiConfigInput,
  prompt: string,
  maxTokens: number,
  onChunk: (text: string) => void,
): Promise<string> {
  if (!config.apiKey) throw new Error('Anthropic protocol requires an API key');
  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.endpoint });
  const stream = client.messages.stream({
    model: config.model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  return new Promise((resolve, reject) => {
    let fullText = '';
    stream.on('text', (text) => {
      fullText += text;
      onChunk(text);
    });
    stream.on('finalMessage', () => resolve(fullText));
    stream.on('error', reject);
  });
}

export function streamAiText(
  config: AiConfigInput,
  prompt: string,
  maxTokens: number,
  onChunk: (text: string) => void,
): Promise<string> {
  return config.protocol === 'anthropic'
    ? streamAnthropicText(config, prompt, maxTokens, onChunk)
    : streamOpenAiText(config, prompt, maxTokens, onChunk);
}

async function testOpenAi(config: AiConfigInput): Promise<string> {
  const response = await fetch(openAiChatUrl(config.endpoint), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(config.apiKey),
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      max_tokens: 10,
      stream: false,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`AI endpoint returned ${response.status}: ${detail.slice(0, 300)}`);
  }
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return payload.choices?.[0]?.message?.content || 'Connected';
}

async function testAnthropic(config: AiConfigInput): Promise<string> {
  if (!config.apiKey) throw new Error('Anthropic protocol requires an API key');
  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.endpoint });
  const message = await client.messages.create({
    model: config.model,
    max_tokens: 10,
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
  });
  const text = message.content.find((content) => content.type === 'text');
  return text?.type === 'text' ? text.text : 'Connected';
}

export async function testAiConnection(config: AiConfigInput): Promise<string> {
  return config.protocol === 'anthropic' ? testAnthropic(config) : testOpenAi(config);
}
