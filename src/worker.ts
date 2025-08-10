interface LoadBalancerConfig {
  origins: string[];
  originTimeoutMs: number;
  retries: number;
  failStatuses: Set<number>;
  diagPath: string;
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

    return {
      origins,
      originTimeoutMs,
      retries,
      failStatuses,
      diagPath
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

  private buildDiagnosticResponse(): Response {
    const diagnostics = {
      service: 'Simple Load Balancer (SLB)',
      version: '1.0.0-mvp',
      timestamp: new Date().toISOString(),
      config: {
        origins: this.config.origins,
        originTimeoutMs: this.config.originTimeoutMs,
        retries: this.config.retries,
        failStatuses: Array.from(this.config.failStatuses).sort(),
        diagPath: this.config.diagPath
      }
    };

    return new Response(JSON.stringify(diagnostics, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === this.config.diagPath) {
      return this.buildDiagnosticResponse();
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
        
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders
        });
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