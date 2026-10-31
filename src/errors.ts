/** An upstream artifact the selected OMP version needs is not published yet. */
export class UpstreamPendingError extends Error {
  constructor(public readonly missing: string) {
    super(`upstream artifact not available yet: ${missing}`);
    this.name = "UpstreamPendingError";
  }
}

/** Anything that prevents a check from producing a verdict about the plugin. */
export class InfraError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "InfraError";
  }
}
