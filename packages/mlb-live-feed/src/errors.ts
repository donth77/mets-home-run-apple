export class MlbFeedError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "MlbFeedError";
  }
}
