import http from 'http';

interface MockServerOptions {
  port: number;
  delay?: number;
  failureRate?: number;
  failureStatus?: number;
}

export class MockServer {
  private server: http.Server;
  private port: number;
  private delay: number;
  private failureRate: number;
  private failureStatus: number;

  constructor(options: MockServerOptions) {
    this.port = options.port;
    this.delay = options.delay || 0;
    this.failureRate = options.failureRate || 0;
    this.failureStatus = options.failureStatus || 500;

    this.server = http.createServer((req, res) => {
      const shouldFail = Math.random() < this.failureRate;
      
      setTimeout(() => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('X-Origin-Server', `mock-server-${this.port}`);
        
        if (shouldFail) {
          res.writeHead(this.failureStatus);
          res.end(JSON.stringify({ 
            error: 'Mock server failure', 
            server: `mock-server-${this.port}`,
            timestamp: new Date().toISOString()
          }));
        } else {
          res.writeHead(200);
          res.end(JSON.stringify({ 
            message: 'Success from mock server',
            server: `mock-server-${this.port}`,
            path: req.url,
            method: req.method,
            timestamp: new Date().toISOString()
          }));
        }
      }, this.delay);
    });
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`Mock server started on port ${this.port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        console.log(`Mock server on port ${this.port} stopped`);
        resolve();
      });
    });
  }

  setFailureRate(rate: number) {
    this.failureRate = rate;
  }

  setDelay(delay: number) {
    this.delay = delay;
  }
}

// Helper function to start multiple mock servers
export async function startMockServers(configs: MockServerOptions[]): Promise<MockServer[]> {
  const servers = configs.map(config => new MockServer(config));
  await Promise.all(servers.map(server => server.start()));
  return servers;
}

// Helper function to stop multiple mock servers
export async function stopMockServers(servers: MockServer[]): Promise<void> {
  await Promise.all(servers.map(server => server.stop()));
}

// Default configuration for testing
export const defaultMockConfig: MockServerOptions[] = [
  { port: 9001, delay: 100 },
  { port: 9002, delay: 150 }
];