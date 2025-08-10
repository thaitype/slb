# SLB - Serverless Load Balancer

A serverless load balancer for low budget infrastructure. Built on Cloudflare Workers, SLB provides cost-effective load balancing without managing servers or paying fixed costs.

## Features
- **Serverless architecture** - No servers to manage, scales automatically
- **Cost-effective** - Pay per request, no fixed infrastructure costs
- **Stateless load balancing** - Random origin selection per request
- **Automatic failover** - Retry failed requests on healthy origins
- **Configurable timeouts** - Set request timeouts and retry limits
- **Health diagnostics** - Built-in health check and configuration endpoint
- **Easy testing** - Mock origin servers for local development

## Installation

```bash
pnpm install
```

## Configuration

Configure SLB using environment variables:

- `ORIGINS` - Comma-separated list of backend servers (required)
- `ORIGIN_TIMEOUT_MS` - Request timeout in milliseconds (default: 8000)
- `RETRIES` - Number of retry attempts (default: 1)
- `FAIL_STATUSES` - HTTP status codes to treat as failures (default: 500,504,521,522,523)
- `LB_DIAG_PATH` - Health check endpoint path (default: /__lb/health)

Example `.dev.vars` for local development:
```
ORIGINS=http://localhost:9001,http://localhost:9002
ORIGIN_TIMEOUT_MS=3000
RETRIES=1
```

## Development

```bash
# Start mock origin servers for testing
pnpm mock:servers

# Start local development server
pnpm dev

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Lint and format code
pnpm lint
pnpm format
```

## Testing

1. Start mock origin servers:
   ```bash
   pnpm mock:servers
   ```

2. In another terminal, start the load balancer:
   ```bash
   pnpm dev
   ```

3. Test the load balancer:
   ```bash
   # Test load balancing
   curl http://localhost:8787/api/test
   
   # Check health and configuration
   curl http://localhost:8787/__lb/health
   ```

## API Endpoints

- `GET /__lb/health` - Returns health status and configuration
- `*` - All other requests are proxied to configured origins with load balancing

## Deployment

Deploy to Cloudflare Workers:

```bash
# Deploy to production
pnpm wrangler:deploy

# Set environment variables
wrangler vars set ORIGINS "https://api1.example.com,https://api2.example.com"
wrangler vars set ORIGIN_TIMEOUT_MS "5000"
```

## License

MIT