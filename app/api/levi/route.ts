import { generateText, jsonSchema, Output } from 'ai'
import {
  LEVI_MODE,
  LEVI_RESPONSE_SCHEMA,
  LEVI_SOURCE,
  leviInstructions,
  type LeviAIResponse,
} from '@/lib/levi-architecture'

type IncomingMessage = {
  role: 'user' | 'assistant'
  content: string
}

const MAX_BODY_BYTES = 18_000
const MAX_MESSAGES = 12
const MAX_MESSAGE_CHARS = 800

function validSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,72}$/.test(value)
}

function cleanMessages(value: unknown): IncomingMessage[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) return null

  const messages: IncomingMessage[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const role = Reflect.get(item, 'role')
    const content = Reflect.get(item, 'content')
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null

    const trimmed = content.trim()
    if (!trimmed || trimmed.length > MAX_MESSAGE_CHARS) return null
    messages.push({ role, content: trimmed })
  }

  if (messages.at(-1)?.role !== 'user') return null
  return messages
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url)
  const origin = request.headers.get('origin')
  if (origin) {
    try {
      if (new URL(origin).host !== requestUrl.host) {
        return Response.json({ error: 'origin_not_allowed' }, { status: 403 })
      }
    } catch {
      return Response.json({ error: 'origin_not_allowed' }, { status: 403 })
    }
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: 'request_too_large' }, { status: 413 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!payload || typeof payload !== 'object') {
    return Response.json({ error: 'invalid_request' }, { status: 400 })
  }

  const locale = Reflect.get(payload, 'locale') === 'en' ? 'en' : 'pt'
  const sessionId = Reflect.get(payload, 'sessionId')
  const messages = cleanMessages(Reflect.get(payload, 'messages'))

  if (!validSessionId(sessionId) || !messages) {
    return Response.json({ error: 'invalid_request' }, { status: 400 })
  }

  try {
    const result = await generateText({
      model: process.env.LEVI_MODEL ?? 'openai/gpt-5.6-sol',
      instructions: leviInstructions(locale),
      messages,
      output: Output.object({
        schema: jsonSchema<LeviAIResponse>(LEVI_RESPONSE_SCHEMA),
        name: 'levi_public_pre_diagnosis',
        description: 'Structured response for Cassiellos public business pre-diagnosis.',
      }),
      maxOutputTokens: 900,
      temperature: 0.25,
      maxRetries: 1,
      timeout: { totalMs: 22_000 },
      providerOptions: {
        gateway: {
          user: sessionId,
          tags: ['feature:levi-public', 'mode:pre-diagnosis', 'env:production'],
        },
      },
    })

    return Response.json(
      {
        ...result.output,
        mode: LEVI_MODE,
        source: LEVI_SOURCE,
        toolsUsed: [],
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('Levi generation failed', error instanceof Error ? error.name : 'UnknownError')
    return Response.json(
      {
        error: 'levi_unavailable',
        message:
          locale === 'en'
            ? 'Levi is temporarily unavailable. You can still talk directly to the Cassiellos team.'
            : 'O Levi está temporariamente indisponível. Você ainda pode conversar diretamente com a equipe Cassiellos.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
