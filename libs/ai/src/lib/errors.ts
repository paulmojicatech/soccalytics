export class AiError extends Error {
  constructor(
    message: string,
    readonly code: 'refusal' | 'truncated' | 'invalid_output' | 'unavailable',
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
