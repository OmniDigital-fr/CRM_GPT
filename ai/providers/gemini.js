import {GoogleGenAI} from '@google/genai';
import {AiProviderError} from './errors.js';

export const GEMINI_MODEL = 'gemini-3.5-flash-lite';

// Gemini supports a subset of JSON Schema. The full schema remains enforced locally.
function geminiSchema(value) {
  if (Array.isArray(value)) return value.map(geminiSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['minLength', 'maxLength'].includes(key))
    .map(([key, child]) => [key, geminiSchema(child)]));
}

async function boundedResponse(response) {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256_000) throw new AiProviderError('api_response_invalid');
      parts.push(Buffer.from(value));
    }
    return new Response(Buffer.concat(parts), {
      status: response.status,
      headers: response.headers
    });
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function createGeminiProvider({key, model, timeoutMs, fetcher = fetch}) {
  return {
    id: 'gemini',
    async generate({instructions, input, schema, maxOutputTokens}) {
      const deadline = AbortSignal.timeout(timeoutMs);
      try {
        const client = new GoogleGenAI({
          apiKey: key,
          vertexai: false,
          httpOptions: {
            baseUrl: 'https://generativelanguage.googleapis.com',
            apiVersion: 'v1beta',
            retryOptions: {attempts: 1},
            fetch: async (url, options) => boundedResponse(await fetcher(url, {...options, redirect: 'error'}))
          }
        });
        const data = await client.models.generateContent({
          model,
          contents: [{role: 'user', parts: [{text: JSON.stringify(input)}]}],
          config: {
            systemInstruction: instructions,
            responseMimeType: 'application/json',
            responseJsonSchema: geminiSchema(schema),
            maxOutputTokens,
            abortSignal: deadline,
            ...(model === GEMINI_MODEL ? {thinkingConfig: {thinkingLevel: 'MINIMAL'}} : {})
          }
        });
        const candidate = data.candidates?.[0];
        const output = candidate?.finishReason === 'STOP'
          ? candidate.content?.parts?.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('')
          : null;
        const usage = data.usageMetadata;
        const inputTokens = usage?.promptTokenCount;
        const reportedOutput = usage?.candidatesTokenCount ?? 0;
        const thoughts = usage?.thoughtsTokenCount ?? 0;
        const total = usage?.totalTokenCount;
        const counts = [inputTokens, reportedOutput, thoughts, total].filter(count => count !== undefined);
        const validUsage = counts.every(count => Number.isSafeInteger(count) && count >= 0);
        const outputTokens = validUsage && (total !== undefined || usage?.candidatesTokenCount !== undefined)
          ? Math.max(0, (total ?? 0) - (inputTokens ?? 0), reportedOutput + thoughts)
          : null;
        return {output, model: data.modelVersion || model, inputTokens:validUsage?inputTokens:null, outputTokens};
      } catch (error) {
        if (deadline.aborted || error?.name === 'TimeoutError') throw new AiProviderError('api_timeout');
        if (error instanceof AiProviderError) throw error;
        if (error?.status === 429) throw new AiProviderError('api_quota');
        if ([401, 403].includes(error?.status) || (error?.status === 400 && /API_KEY_INVALID|API key not valid/i.test(error.message))) {
          throw new AiProviderError('api_credentials');
        }
        throw new AiProviderError('api_unavailable');
      }
    }
  };
}
