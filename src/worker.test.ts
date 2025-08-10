import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import worker from './worker';

// Mock environment for testing
const mockEnv = {
  ORIGINS: 'http://localhost:9001,http://localhost:9002',
  ORIGIN_TIMEOUT_MS: '3000',
  RETRIES: '1',
  FAIL_STATUSES: '500,502,503',
  LB_DIAG_PATH: '/__lb/health'
};

// Mock environment with CORS enabled
const mockEnvWithCors = {
  ...mockEnv,
  CORS_ENABLED: 'true',
  CORS_ALLOW_ORIGINS: 'https://example.com,https://app.example.com',
  CORS_ALLOW_METHODS: 'GET,POST,PUT,DELETE,OPTIONS',
  CORS_ALLOW_HEADERS: 'Content-Type,Authorization,X-Custom-Header',
  CORS_EXPOSE_HEADERS: 'X-Total-Count',
  CORS_ALLOW_CREDENTIALS: 'false',
  CORS_MAX_AGE_SEC: '3600'
};

// Mock environment with CORS wildcard
const mockEnvWithCorsWildcard = {
  ...mockEnv,
  CORS_ENABLED: 'true',
  CORS_ALLOW_ORIGINS: '*',
  CORS_ALLOW_CREDENTIALS: 'false'
};

// Mock environment with CORS wildcard + credentials
const mockEnvWithCorsWildcardCredentials = {
  ...mockEnv,
  CORS_ENABLED: 'true',
  CORS_ALLOW_ORIGINS: '*',
  CORS_ALLOW_CREDENTIALS: 'true'
};

// Mock fetch globally for unit tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Load Balancer Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('Configuration Parsing', () => {
    it('should handle valid configuration', async () => {
      const request = new Request('http://localhost/__lb/health');
      
      mockFetch.mockResolvedValue(new Response('{}'));
      
      const response = await worker.fetch(request, mockEnv);
      const diagnostics = await response.json();
      
      expect(response.status).toBe(200);
      expect(diagnostics.config.originCount).toBe(2);
      expect(diagnostics.config.originTimeoutMs).toBe(3000);
      expect(diagnostics.config.retries).toBe(1);
      expect(diagnostics.config.failStatuses).toEqual([500, 502, 503]);
      
      // Verify sensitive origins data is not exposed
      expect(diagnostics.config.origins).toBeUndefined();
    });

    it('should handle missing ORIGINS and return error', async () => {
      const request = new Request('http://localhost/test');
      const envWithoutOrigins = { ...mockEnv, ORIGINS: '' };
      
      const response = await worker.fetch(request, envWithoutOrigins);
      
      expect(response.status).toBe(500);
      const error = await response.json();
      expect(error.error).toBe('Load balancer configuration error');
    });

    it('should use default values for optional config', async () => {
      const request = new Request('http://localhost/__lb/health');
      const minimalEnv = { ORIGINS: 'http://localhost:9001' };
      
      const response = await worker.fetch(request, minimalEnv);
      const diagnostics = await response.json();
      
      expect(diagnostics.config.originTimeoutMs).toBe(8000);
      expect(diagnostics.config.retries).toBe(1);
      expect(diagnostics.config.failStatuses).toEqual([500, 504, 521, 522, 523]);
      expect(diagnostics.config.diagPath).toBe('/__lb/health');
    });
  });

  describe('Request Handling', () => {
    it('should return diagnostics for health endpoint', async () => {
      const request = new Request('http://localhost/__lb/health');
      
      const response = await worker.fetch(request, mockEnv);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json');
      
      const diagnostics = await response.json();
      expect(diagnostics.service).toBe('Simple Load Balancer (SLB)');
      expect(diagnostics.version).toBe('1.0.0-mvp');
      expect(diagnostics.config).toBeDefined();
    });

    it('should proxy successful requests to origin', async () => {
      const request = new Request('http://localhost/api/test', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      const mockOriginResponse = new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

      mockFetch.mockResolvedValue(mockOriginResponse);

      const response = await worker.fetch(request, mockEnv);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('X-LB-Origin')).toMatch(/http:\/\/localhost:900[12]/);
      expect(response.headers.get('X-LB-Attempt')).toBe('1');
      
      const responseData = await response.json();
      expect(responseData.success).toBe(true);
    });

    it('should retry on origin failure', async () => {
      const request = new Request('http://localhost/api/test');

      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true }), { status: 200 })
        );

      const response = await worker.fetch(request, mockEnv);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('X-LB-Attempt')).toBe('2');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should return 502 when all origins fail', async () => {
      const request = new Request('http://localhost/api/test');

      mockFetch.mockRejectedValue(new Error('All origins down'));

      const response = await worker.fetch(request, mockEnv);
      
      expect(response.status).toBe(502);
      expect(response.headers.get('content-type')).toBe('application/json');
      
      const errorData = await response.json();
      expect(errorData.error).toBe('All origins failed');
      expect(errorData.attempts).toBe(2); // retries + 1
    });

    it('should treat configured fail statuses as failures', async () => {
      const request = new Request('http://localhost/api/test');

      mockFetch
        .mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

      const response = await worker.fetch(request, mockEnv);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('X-LB-Attempt')).toBe('2');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout and retry on slow origins', async () => {
      const request = new Request('http://localhost/api/test');

      // First call times out (simulate AbortError), second succeeds
      mockFetch
        .mockImplementationOnce(() => {
          // Simulate an aborted/timeout request
          const error = new Error('This operation was aborted');
          error.name = 'AbortError';
          return Promise.reject(error);
        })
        .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

      const response = await worker.fetch(request, mockEnv);
      
      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('CORS Handling', () => {
    describe('Configuration', () => {
      it('should include safe CORS configuration in diagnostics when enabled', async () => {
        const request = new Request('http://localhost/__lb/health');
        
        const response = await worker.fetch(request, mockEnvWithCors);
        const diagnostics = await response.json();
        
        // Verify CORS configuration is included (but not sensitive allowlist)
        expect(diagnostics.config.corsEnabled).toBe(true);
        expect(diagnostics.config.corsAllowMethods).toEqual(['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']);
        expect(diagnostics.config.corsAllowHeaders).toEqual(['Content-Type', 'Authorization', 'X-Custom-Header']);
        expect(diagnostics.config.corsExposeHeaders).toEqual(['X-Total-Count']);
        expect(diagnostics.config.corsAllowCredentials).toBe(false);
        expect(diagnostics.config.corsMaxAgeSec).toBe(3600);
        
        // Verify sensitive data is not exposed
        expect(diagnostics.config.corsAllowOrigins).toBeUndefined();
        expect(diagnostics.config.origins).toBeUndefined();
        
        // Verify we get origin count instead
        expect(diagnostics.config.originCount).toBe(2);
      });
    });

    describe('Preflight Requests', () => {
      it('should handle valid CORS preflight request', async () => {
        const request = new Request('http://localhost/api/test', {
          method: 'OPTIONS',
          headers: {
            'Origin': 'https://example.com',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'Content-Type,Authorization'
          }
        });

        const response = await worker.fetch(request, mockEnvWithCors);
        
        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
        expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, DELETE, OPTIONS');
        expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type,Authorization');
        expect(response.headers.get('Access-Control-Max-Age')).toBe('3600');
        expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
      });

      it('should reject CORS preflight from disallowed origin', async () => {
        const request = new Request('http://localhost/api/test', {
          method: 'OPTIONS',
          headers: {
            'Origin': 'https://malicious.com',
            'Access-Control-Request-Method': 'POST'
          }
        });

        const response = await worker.fetch(request, mockEnvWithCors);
        
        expect(response.status).toBe(403);
        const errorData = await response.json();
        expect(errorData.error).toBe('cors_denied');
      });

      it('should handle preflight with wildcard origin', async () => {
        const request = new Request('http://localhost/api/test', {
          method: 'OPTIONS',
          headers: {
            'Origin': 'https://any-domain.com',
            'Access-Control-Request-Method': 'GET'
          }
        });

        const response = await worker.fetch(request, mockEnvWithCorsWildcard);
        
        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      });

      it('should echo origin when wildcard + credentials', async () => {
        const request = new Request('http://localhost/api/test', {
          method: 'OPTIONS',
          headers: {
            'Origin': 'https://trusted.com',
            'Access-Control-Request-Method': 'GET'
          }
        });

        const response = await worker.fetch(request, mockEnvWithCorsWildcardCredentials);
        
        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://trusted.com');
        expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
      });
    });

    describe('Simple Requests', () => {
      it('should add CORS headers to successful responses', async () => {
        const request = new Request('http://localhost/api/test', {
          headers: { 'Origin': 'https://example.com' }
        });

        mockFetch.mockResolvedValue(
          new Response(JSON.stringify({ success: true }), { status: 200 })
        );

        const response = await worker.fetch(request, mockEnvWithCors);
        
        expect(response.status).toBe(200);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
        expect(response.headers.get('Access-Control-Expose-Headers')).toBe('X-Total-Count');
        expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
      });

      it('should not add CORS headers for disallowed origin', async () => {
        const request = new Request('http://localhost/api/test', {
          headers: { 'Origin': 'https://malicious.com' }
        });

        mockFetch.mockResolvedValue(
          new Response(JSON.stringify({ success: true }), { status: 200 })
        );

        const response = await worker.fetch(request, mockEnvWithCors);
        
        expect(response.status).toBe(200);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      });

      it('should add CORS headers to diagnostic endpoint', async () => {
        const request = new Request('http://localhost/__lb/health', {
          headers: { 'Origin': 'https://example.com' }
        });

        const response = await worker.fetch(request, mockEnvWithCors);
        
        expect(response.status).toBe(200);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
      });

      it('should not add CORS headers when disabled', async () => {
        const request = new Request('http://localhost/api/test', {
          headers: { 'Origin': 'https://example.com' }
        });

        mockFetch.mockResolvedValue(
          new Response(JSON.stringify({ success: true }), { status: 200 })
        );

        const response = await worker.fetch(request, mockEnv);
        
        expect(response.status).toBe(200);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      });
    });
  });
});