export class AiProviderError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
