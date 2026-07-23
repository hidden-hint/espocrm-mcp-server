import { EspoApiError } from "../errors.js";
import { credentialHeaders, type EspoCredential } from "./credential.js";
import { applyQuery } from "./query.js";

export interface ListResult<T = Record<string, unknown>> {
  total: number;
  list: T[];
}

type QueryParams = Record<string, unknown>;

export class EspoClient {
  readonly baseUrl: string;
  private readonly credential: EspoCredential;

  constructor(baseUrl: string, credential: EspoCredential) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.credential = credential;
  }

  find(entityType: string, params: QueryParams): Promise<ListResult> {
    return this.request("GET", encodeURIComponent(entityType), { query: params });
  }

  getRecord(entityType: string, id: string, params: QueryParams): Promise<Record<string, unknown>> {
    return this.request("GET", `${encodeURIComponent(entityType)}/${encodeURIComponent(id)}`, { query: params });
  }

  getStream(entityType: string, id: string, params: QueryParams): Promise<ListResult> {
    return this.request("GET", `${encodeURIComponent(entityType)}/${encodeURIComponent(id)}/stream`, { query: params });
  }

  getMetadata(): Promise<Record<string, unknown>> {
    return this.request("GET", "Metadata", {});
  }

  getAppUser(): Promise<Record<string, unknown>> {
    return this.request("GET", "App/user", {});
  }

  create(entityType: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("POST", encodeURIComponent(entityType), { body: data });
  }

  update(entityType: string, id: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("PATCH", `${encodeURIComponent(entityType)}/${encodeURIComponent(id)}`, { body: data });
  }

  deleteRecord(entityType: string, id: string): Promise<unknown> {
    return this.request("DELETE", `${encodeURIComponent(entityType)}/${encodeURIComponent(id)}`, {});
  }

  private async request<T>(
    method: string,
    path: string,
    options: { query?: QueryParams; body?: unknown },
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1/${path}`);
    if (options.query !== undefined) {
      applyQuery(url.searchParams, options.query);
    }

    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...credentialHeaders(this.credential),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new EspoApiError(response.status, text);
    }

    return (text === "" ? null : JSON.parse(text)) as T;
  }
}
