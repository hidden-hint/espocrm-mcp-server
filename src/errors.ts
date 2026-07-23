export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class EspoApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`EspoCRM API error ${status}`);
    this.name = "EspoApiError";
  }
}
