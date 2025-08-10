# SLB - Serverless Load Balancer

A serverless load balancer for low budget infrastructure. Built on Cloudflare Workers, SLB provides cost-effective load balancing without managing servers or paying fixed costs.

## Features
- **Serverless & cost-effective** - Pay per request, no fixed costs or servers to manage
- **Automatic failover** - Retry failed requests with configurable timeouts
- **CORS support** - Full cross-origin request handling for web apps
- **Health diagnostics** - Built-in monitoring and configuration endpoint

## Installation

```bash
pnpm install
```

## Configuration

Key environment variables:

- `ORIGINS` - Backend servers (required): `https://api1.com,https://api2.com`
- `ORIGIN_TIMEOUT_MS` - Request timeout (default: 8000)
- `RETRIES` - Retry attempts (default: 1)
- `CORS_ENABLED` - Enable CORS (default: false)
- `CORS_ALLOW_ORIGINS` - Allowed origins: `https://myapp.com` or `*`
- `CORS_ALLOW_CREDENTIALS` - Allow credentials (default: false)

Example `.dev.vars`:
```
ORIGINS=http://localhost:9001,http://localhost:9002
CORS_ENABLED=true
CORS_ALLOW_ORIGINS=http://localhost:3000
```

## Quick Start

```bash
# Start mock servers and load balancer
pnpm mock:servers  # Terminal 1
pnpm dev           # Terminal 2

# Test load balancing
curl http://localhost:8787/api/test
curl http://localhost:8787/__lb/health

# Run tests
pnpm test
```

## API

- `/__lb/health` - Health status and configuration
- `*` - All requests proxied to origins with load balancing and CORS support

## Deployment

```bash
# Deploy to Cloudflare Workers
pnpm wrangler:deploy

# Set production variables
wrangler vars set ORIGINS "https://api1.com,https://api2.com"
wrangler vars set CORS_ENABLED "true"
wrangler vars set CORS_ALLOW_ORIGINS "https://myapp.com"
```

## License

MIT