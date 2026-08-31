export class WebFetchError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "WebFetchError";
  }
}

export class WebSearchError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "WebSearchError";
  }
}
