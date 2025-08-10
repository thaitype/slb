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
      expect(diagnostics.config.origins).toEqual([
        'http://localhost:9001',
        'http://localhost:9002'
      ]);
      expect(diagnostics.config.originTimeoutMs).toBe(3000);
      expect(diagnostics.config.retries).toBe(1);
      expect(diagnostics.config.failStatuses).toEqual([500, 502, 503]);
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

      // First call times out, second succeeds
      mockFetch
        .mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(new Response('timeout')), 5000)))
        .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

      const response = await worker.fetch(request, mockEnv);
      
      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 10000); // 10 second timeout for this test
  });
});