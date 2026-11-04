import {createGeminiProvider} from './gemini.js';
export {GEMINI_MODEL} from './gemini.js';
export {AiProviderError} from './errors.js';

// Qualification depends on generate({instructions, input, schema, maxOutputTokens}).
// Providers normalize the result to {output, model, inputTokens, outputTokens}.
export function createQualificationProvider(config, fetcher) {
  return createGeminiProvider({...config, fetcher});
}
