import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import axiosRetry from 'axios-retry';
import CircuitBreaker from 'opossum';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type HttpClientOptions = {
  timeoutMs?: number;
  retry?: {
    retries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  breaker?: {
    enabled?: boolean;
    timeoutMs?: number; // max time for 1 request within breaker
    errorThresholdPercentage?: number;
    resetTimeoutMs?: number;
    rollingCountTimeoutMs?: number;
    rollingCountBuckets?: number;
  };
};

export type HttpResponse<T> = {
  status: number;
  data: T;
  headers: Record<string, any>;
};

@Injectable()
export class HttpClient {
  private readonly logger = new Logger(HttpClient.name);
  private readonly axios: AxiosInstance;

  // breaker per "serviceKey" (biar failure Catalog nggak bikin Order ikut keblok)
  private readonly breakers = new Map<
    string,
    CircuitBreaker<HttpResponse<any>>
  >();

  constructor() {
    const timeoutMs = Number(process.env.HTTP_TIMEOUT_MS ?? 6000);

    this.axios = axios.create({
      timeout: timeoutMs,
      // optional: validateStatus: () => true, // kalau kamu mau handle 4xx/5xx sendiri
    });

    // ========= Retry (axios-retry) =========
    const retries = Number(process.env.HTTP_RETRY_COUNT ?? 2);
    const baseDelayMs = Number(process.env.HTTP_RETRY_BASE_DELAY_MS ?? 250);
    const maxDelayMs = Number(process.env.HTTP_RETRY_MAX_DELAY_MS ?? 1500);

    axiosRetry(this.axios, {
      retries,
      retryCondition: (error) => this.shouldRetry(error),
      retryDelay: (retryCount, error) => {
        // exponential backoff + jitter
        const expo = Math.min(maxDelayMs, baseDelayMs * 2 ** (retryCount - 1));
        const jitter = Math.floor(Math.random() * 100);
        const delay = expo + jitter;

        const status = (error as any)?.response?.status;
        this.logger.warn(
          `HTTP retry #${retryCount} in ${delay}ms (status=${status ?? 'NA'}) url=${error.config?.url}`,
        );
        return delay;
      },
    });

    // ========= Request/Response logging hooks =========
    this.axios.interceptors.request.use((config) => {
      // correlation id support (jika ada header)
      // config.headers['x-correlation-id'] ||= ...
      return config;
    });

    this.axios.interceptors.response.use(
      (res) => res,
      (err: AxiosError) => {
        const status = err.response?.status;
        this.logger.warn(
          `HTTP error status=${status ?? 'NA'} url=${err.config?.url} msg=${err.message}`,
        );
        throw err;
      },
    );
  }

  // ---------- Public API ----------
  async get<T>(
    url: string,
    config?: AxiosRequestConfig,
    opts?: HttpClientOptions,
  ) {
    return this.request<T>('GET', url, undefined, config, opts);
  }

  async post<T>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
    opts?: HttpClientOptions,
  ) {
    return this.request<T>('POST', url, data, config, opts);
  }

  async put<T>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
    opts?: HttpClientOptions,
  ) {
    return this.request<T>('PUT', url, data, config, opts);
  }

  async patch<T>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
    opts?: HttpClientOptions,
  ) {
    return this.request<T>('PATCH', url, data, config, opts);
  }

  async delete<T>(
    url: string,
    config?: AxiosRequestConfig,
    opts?: HttpClientOptions,
  ) {
    return this.request<T>('DELETE', url, undefined, config, opts);
  }

  // ---------- Core Request w/ breaker ----------
  private async request<T>(
    method: HttpMethod,
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
    opts?: HttpClientOptions,
  ): Promise<T> {
    const mergedOpts = this.mergeOptions(opts);

    const serviceKey = this.deriveServiceKey(url); // misal: catalog-service / order-service
    if (mergedOpts.breaker.enabled) {
      const breaker = this.getOrCreateBreaker(serviceKey, mergedOpts);
      const res = await breaker.fire({
        method,
        url,
        data,
        config,
        timeoutMs: mergedOpts.timeoutMs,
      });
      return res.data as T;
    }

    const res = await this.doAxios({
      method,
      url,
      data,
      config,
      timeoutMs: mergedOpts.timeoutMs,
    });
    return res.data as T;
  }

  private async doAxios(args: {
    method: HttpMethod;
    url: string;
    data?: any;
    config?: AxiosRequestConfig;
    timeoutMs: number;
  }): Promise<HttpResponse<any>> {
    const { method, url, data, config, timeoutMs } = args;

    const res = await this.axios.request({
      method,
      url,
      data,
      timeout: timeoutMs,
      ...config,
      headers: {
        ...(config?.headers ?? {}),
      },
    });

    return { status: res.status, data: res.data, headers: res.headers as any };
  }

  // ---------- Circuit Breaker ----------
  private getOrCreateBreaker(
    serviceKey: string,
    opts: Required<HttpClientOptions>,
  ) {
    const existing = this.breakers.get(serviceKey);
    if (existing) return existing;

    const breaker = new CircuitBreaker(
      async (args: {
        method: HttpMethod;
        url: string;
        data?: any;
        config?: AxiosRequestConfig;
        timeoutMs: number;
      }) => this.doAxios(args),
      {
        timeout: opts.breaker.timeoutMs, // max time for function before breaker counts as failure
        errorThresholdPercentage: opts.breaker.errorThresholdPercentage,
        resetTimeout: opts.breaker.resetTimeoutMs,
        rollingCountTimeout: opts.breaker.rollingCountTimeoutMs,
        rollingCountBuckets: opts.breaker.rollingCountBuckets,
      },
    );

    breaker.on('open', () => this.logger.error(`Breaker OPEN: ${serviceKey}`));
    breaker.on('halfOpen', () =>
      this.logger.warn(`Breaker HALF-OPEN: ${serviceKey}`),
    );
    breaker.on('close', () => this.logger.log(`Breaker CLOSE: ${serviceKey}`));
    breaker.on('reject', () =>
      this.logger.warn(`Breaker REJECT: ${serviceKey}`),
    );
    breaker.on('timeout', () =>
      this.logger.warn(`Breaker TIMEOUT: ${serviceKey}`),
    );
    breaker.on('failure', (err) =>
      this.logger.warn(
        `Breaker FAILURE: ${serviceKey} err=${this.safeErr(err)}`,
      ),
    );

    // optional fallback (misal: kalau catalog down, return empty list)
    // breaker.fallback(() => ({ status: 200, data: [], headers: {} }));

    this.breakers.set(serviceKey, breaker);
    return breaker;
  }

  // ---------- Retry policy ----------
  private shouldRetry(error: any) {
    // retry for network errors / timeouts
    if (axiosRetry.isNetworkOrIdempotentRequestError(error)) return true;

    // optionally retry 429/503/502
    const status = error?.response?.status;
    if ([429, 502, 503, 504].includes(status)) return true;

    return false;
  }

  // ---------- Options ----------
  private mergeOptions(opts?: HttpClientOptions): Required<HttpClientOptions> {
    const timeoutMs =
      opts?.timeoutMs ?? Number(process.env.HTTP_TIMEOUT_MS ?? 6000);

    return {
      timeoutMs,
      retry: {
        retries:
          opts?.retry?.retries ?? Number(process.env.HTTP_RETRY_COUNT ?? 2),
        baseDelayMs:
          opts?.retry?.baseDelayMs ??
          Number(process.env.HTTP_RETRY_BASE_DELAY_MS ?? 250),
        maxDelayMs:
          opts?.retry?.maxDelayMs ??
          Number(process.env.HTTP_RETRY_MAX_DELAY_MS ?? 1500),
      },
      breaker: {
        enabled:
          opts?.breaker?.enabled ??
          (process.env.HTTP_BREAKER_ENABLED ?? 'true') === 'true',
        timeoutMs:
          opts?.breaker?.timeoutMs ??
          Number(process.env.HTTP_BREAKER_TIMEOUT_MS ?? 3500),
        errorThresholdPercentage:
          opts?.breaker?.errorThresholdPercentage ??
          Number(process.env.HTTP_BREAKER_ERR_PCT ?? 50),
        resetTimeoutMs:
          opts?.breaker?.resetTimeoutMs ??
          Number(process.env.HTTP_BREAKER_RESET_MS ?? 10_000),
        rollingCountTimeoutMs:
          opts?.breaker?.rollingCountTimeoutMs ??
          Number(process.env.HTTP_BREAKER_ROLLING_MS ?? 10_000),
        rollingCountBuckets:
          opts?.breaker?.rollingCountBuckets ??
          Number(process.env.HTTP_BREAKER_BUCKETS ?? 10),
      },
    };
  }

  // ---------- Helpers ----------
  private deriveServiceKey(url: string) {
    // Cara simpel: pakai hostname sebagai key
    // contoh: http://catalog-service:3001/products -> catalog-service
    try {
      const u = new URL(url);
      return u.hostname;
    } catch {
      // kalau relative url
      return 'default';
    }
  }

  private safeErr(err: any) {
    if (!err) return 'unknown';
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
