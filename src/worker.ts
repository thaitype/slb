interface LoadBalancerConfig {
  origins: string[];
  originTimeoutMs: number;
  retries: number;
  failStatuses: Set<number>;
  diagPath: string;
  corsEnabled: boolean;
  corsAllowOrigins: string[];
  corsAllowMethods: string[];
  corsAllowHeaders: string[];
  corsExposeHeaders?: string[];
  corsAllowCredentials: boolean;
  corsMaxAgeSec: number;
}

class LoadBalancer {
  private config: LoadBalancerConfig;

  constructor(env: any) {
    this.config = this.parseConfig(env);
  }

  private parseConfig(env: any): LoadBalancerConfig {
    const origins = this.parseOrigins(env.ORIGINS);
    if (origins.length === 0) {
      throw new Error('ORIGINS environment variable is required and must contain at least one origin');
    }

    const originTimeoutMs = this.parseTimeout(env.ORIGIN_TIMEOUT_MS);
    const retries = this.parseRetries(env.RETRIES);
    const failStatuses = this.parseFailStatuses(env.FAIL_STATUSES);
    const diagPath = env.LB_DIAG_PATH || '/__lb/health';

    const corsEnabled = this.parseCorsEnabled(env.CORS_ENABLED);
    const corsAllowOrigins = this.parseCorsAllowOrigins(env.CORS_ALLOW_ORIGINS);
    const corsAllowMethods = this.parseCorsAllowMethods(env.CORS_ALLOW_METHODS);
    const corsAllowHeaders = this.parseCorsAllowHeaders(env.CORS_ALLOW_HEADERS);
    const corsExposeHeaders = this.parseCorsExposeHeaders(env.CORS_EXPOSE_HEADERS);
    const corsAllowCredentials = this.parseCorsAllowCredentials(env.CORS_ALLOW_CREDENTIALS);
    const corsMaxAgeSec = this.parseCorsMaxAgeSec(env.CORS_MAX_AGE_SEC);

    return {
      origins,
      originTimeoutMs,
      retries,
      failStatuses,
      diagPath,
      corsEnabled,
      corsAllowOrigins,
      corsAllowMethods,
      corsAllowHeaders,
      corsExposeHeaders,
      corsAllowCredentials,
      corsMaxAgeSec
    };
  }

  private parseOrigins(originsStr: string): string[] {
    if (!originsStr) return [];
    return originsStr.split(',').map(origin => origin.trim()).filter(origin => origin.length > 0);
  }

  private parseTimeout(timeoutStr: string): number {
    const timeout = parseInt(timeoutStr || '8000', 10);
    return Math.max(1000, Math.min(90000, timeout));
  }

  private parseRetries(retriesStr: string): number {
    const retries = parseInt(retriesStr || '1', 10);
    return Math.max(0, Math.min(5, retries));
  }

  private parseFailStatuses(failStatusesStr: string): Set<number> {
    const defaultFailStatuses = [521, 522, 523, 504, 500];
    if (!failStatusesStr) {
      return new Set(defaultFailStatuses);
    }
    
    const statuses = failStatusesStr.split(',')
      .map(status => parseInt(status.trim(), 10))
      .filter(status => !isNaN(status));
    
    return new Set(statuses.length > 0 ? statuses : defaultFailStatuses);
  }

  private parseCorsEnabled(corsEnabledStr: string): boolean {
    return corsEnabledStr?.toLowerCase() === 'true';
  }

  private parseCorsAllowOrigins(corsAllowOriginsStr: string): string[] {
    if (!corsAllowOriginsStr) return [];
    if (corsAllowOriginsStr.trim() === '*') return ['*'];
    return corsAllowOriginsStr.split(',').map(origin => origin.trim()).filter(origin => origin.length > 0);
  }

  private parseCorsAllowMethods(corsAllowMethodsStr: string): string[] {
    const defaultMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
    if (!corsAllowMethodsStr) return defaultMethods;
    return corsAllowMethodsStr.split(',').map(method => method.trim().toUpperCase()).filter(method => method.length > 0);
  }

  private parseCorsAllowHeaders(corsAllowHeadersStr: string): string[] {
    const defaultHeaders = ['Content-Type', 'Authorization'];
    if (!corsAllowHeadersStr) return defaultHeaders;
    return corsAllowHeadersStr.split(',').map(header => header.trim()).filter(header => header.length > 0);
  }

  private parseCorsExposeHeaders(corsExposeHeadersStr: string): string[] | undefined {
    if (!corsExposeHeadersStr) return undefined;
    return corsExposeHeadersStr.split(',').map(header => header.trim()).filter(header => header.length > 0);
  }

  private parseCorsAllowCredentials(corsAllowCredentialsStr: string): boolean {
    return corsAllowCredentialsStr?.toLowerCase() === 'true';
  }

  private parseCorsMaxAgeSec(corsMaxAgeSecStr: string): number {
    const maxAge = parseInt(corsMaxAgeSecStr || '600', 10);
    return Math.max(0, maxAge);
  }

  private isPreflightRequest(request: Request): boolean {
    return request.method === 'OPTIONS' &&
           request.headers.has('Origin') &&
           request.headers.has('Access-Control-Request-Method');
  }

  private isOriginAllowed(origin: string): boolean {
    if (!this.config.corsEnabled) return false;
    if (this.config.corsAllowOrigins.includes('*')) return true;
    return this.config.corsAllowOrigins.includes(origin);
  }

  private getCorsAllowOriginHeader(requestOrigin: string): string {
    if (!this.isOriginAllowed(requestOrigin)) return '';
    
    // If credentials are allowed and we have wildcard, echo the specific origin
    if (this.config.corsAllowCredentials && this.config.corsAllowOrigins.includes('*')) {
      return requestOrigin;
    }
    
    // If wildcard is allowed and no credentials, use wildcard
    if (this.config.corsAllowOrigins.includes('*')) {
      return '*';
    }
    
    // Otherwise, echo the specific origin
    return requestOrigin;
  }

  private handlePreflightRequest(request: Request): Response {
    const origin = request.headers.get('Origin') || '';
    
    if (!this.isOriginAllowed(origin)) {
      return new Response(
        JSON.stringify({ error: 'cors_denied' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const headers = new Headers();
    const allowOrigin = this.getCorsAllowOriginHeader(origin);
    if (allowOrigin) {
      headers.set('Access-Control-Allow-Origin', allowOrigin);
    }
    
    headers.set('Access-Control-Allow-Methods', this.config.corsAllowMethods.join(', '));
    
    // Use request headers if present, otherwise use configured default
    const requestHeaders = request.headers.get('Access-Control-Request-Headers');
    const allowHeaders = requestHeaders || this.config.corsAllowHeaders.join(', ');
    headers.set('Access-Control-Allow-Headers', allowHeaders);
    
    headers.set('Access-Control-Max-Age', this.config.corsMaxAgeSec.toString());
    
    if (this.config.corsAllowCredentials) {
      headers.set('Access-Control-Allow-Credentials', 'true');
    }

    return new Response(null, { status: 204, headers });
  }

  private addCorsHeaders(response: Response, requestOrigin: string): void {
    if (!this.config.corsEnabled) return;
    
    if (!this.isOriginAllowed(requestOrigin)) return;

    const allowOrigin = this.getCorsAllowOriginHeader(requestOrigin);
    if (allowOrigin) {
      response.headers.set('Access-Control-Allow-Origin', allowOrigin);
    }

    if (this.config.corsAllowCredentials) {
      response.headers.set('Access-Control-Allow-Credentials', 'true');
    }

    if (this.config.corsExposeHeaders && this.config.corsExposeHeaders.length > 0) {
      response.headers.set('Access-Control-Expose-Headers', this.config.corsExposeHeaders.join(', '));
    }
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  private async fetchWithTimeout(url: string, request: Request): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.originTimeoutMs);

    try {
      const response = await fetch(url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private async tryOrigin(origin: string, request: Request): Promise<Response | null> {
    try {
      const url = new URL(request.url);
      const targetUrl = `${origin}${url.pathname}${url.search}`;
      
      const response = await this.fetchWithTimeout(targetUrl, request);
      
      if (this.config.failStatuses.has(response.status)) {
        console.log(`Origin ${origin} returned fail status: ${response.status}`);
        return null;
      }
      
      return response;
    } catch (error) {
      console.log(`Origin ${origin} failed:`, error);
      return null;
    }
  }

  private buildDiagnosticResponse(requestOrigin?: string): Response {
    const diagnostics = {
      service: 'Simple Load Balancer (SLB)',
      version: '1.0.0-mvp',
      timestamp: new Date().toISOString(),
      config: {
        origins: this.config.origins,
        originTimeoutMs: this.config.originTimeoutMs,
        retries: this.config.retries,
        failStatuses: Array.from(this.config.failStatuses).sort(),
        diagPath: this.config.diagPath,
        corsEnabled: this.config.corsEnabled,
        corsAllowOrigins: this.config.corsAllowOrigins,
        corsAllowMethods: this.config.corsAllowMethods,
        corsAllowHeaders: this.config.corsAllowHeaders,
        corsExposeHeaders: this.config.corsExposeHeaders,
        corsAllowCredentials: this.config.corsAllowCredentials,
        corsMaxAgeSec: this.config.corsMaxAgeSec
      }
    };

    const response = new Response(JSON.stringify(diagnostics, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

    // Add CORS headers to diagnostic response if origin provided
    if (requestOrigin) {
      this.addCorsHeaders(response, requestOrigin);
    }

    return response;
  }

  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const requestOrigin = request.headers.get('Origin') || '';
    
    if (url.pathname === this.config.diagPath) {
      return this.buildDiagnosticResponse(requestOrigin);
    }

    // Handle CORS preflight requests
    if (this.config.corsEnabled && this.isPreflightRequest(request)) {
      return this.handlePreflightRequest(request);
    }

    const shuffledOrigins = this.shuffleArray(this.config.origins);
    const maxAttempts = Math.min(this.config.retries + 1, shuffledOrigins.length);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const origin = shuffledOrigins[attempt];
      const response = await this.tryOrigin(origin, request);
      
      if (response) {
        const newHeaders = new Headers(response.headers);
        newHeaders.set('X-LB-Origin', origin);
        newHeaders.set('X-LB-Attempt', (attempt + 1).toString());
        
        const newResponse = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders
        });

        // Add CORS headers if enabled and origin is allowed
        this.addCorsHeaders(newResponse, requestOrigin);
        
        return newResponse;
      }
    }

    return new Response(
      JSON.stringify({
        error: 'All origins failed',
        attempts: maxAttempts,
        timestamp: new Date().toISOString()
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    try {
      const loadBalancer = new LoadBalancer(env);
      return await loadBalancer.handleRequest(request);
    } catch (error) {
      console.error('Load balancer error:', error);
      return new Response(
        JSON.stringify({
          error: 'Load balancer configuration error',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  }
};