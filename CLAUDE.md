# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is "slb" - a Cloudflare Worker-based Simple Load Balancer (SLB) project. Despite the minimal TypeScript starter template files, the actual implementation goal is to create a lightweight L7 load balancer that runs on Cloudflare Workers with configurable CORS support.

The project aims to:
- Serve HTTP/HTTPS traffic through a Cloudflare Worker as a load balancer
- Provide stateless per-request load balancing (no sticky sessions)
- Add configurable CORS with origin allowlist, methods, headers, credentials, max-age
- Allow adding/removing origins via environment variables

## Development Commands

Package manager: `pnpm` (preferred, also supports npm/yarn)

### Core Commands
- `pnpm start` - Run the main entry point using tsx
- `pnpm dev` - Run in watch mode with tsx
- `pnpm build` - Build using tsup (outputs ESM + CJS + types)
- `pnpm test` - Run tests with vitest in watch mode
- `pnpm test:ci` - Run tests once (for CI)
- `pnpm test:coverage` - Run tests with v8 coverage report

### Code Quality
- `pnpm lint` - Type check with tsc + eslint + prettier check
- `pnpm lint:fix` - Auto-fix eslint issues + format with prettier
- `pnpm format` - Format code with prettier

## Architecture & Structure

### Current State
The project uses a minimal TypeScript ESM starter template with:
- `src/main.ts` - Entry point (currently has sample fetch + lib usage)
- `src/lib.ts` - Utility functions (currently has sample sum function)
- `src/lib.test.ts` - Test file using vitest

### Target Architecture (per design.md)
The actual implementation should be a Cloudflare Worker (`src/worker.js`) with:
- Request flow: Client → Cloudflare → Worker (LB + CORS) → Origin Pool
- Configuration via environment variables (ORIGINS, timeouts, CORS settings)
- Stateless load balancing with randomized origin selection per request
- Configurable retry logic and failure detection

### Technical Stack
- **Runtime**: Cloudflare Workers (target) / Node.js (development)
- **Build**: tsup (esbuild-based) for ESM/CJS dual output
- **Testing**: vitest with v8 coverage
- **Development**: tsx for TypeScript execution without compilation
- **Linting**: ESLint + typescript-eslint + prettier
- **Type Checking**: TypeScript 5.8+ with strict mode

## Key Configuration Files
- `tsconfig.json` - Bundler module resolution, ESNext target, strict mode
- `package.json` - Dual ESM/CJS exports, development scripts
- `eslint.config.mjs` - ESLint configuration
- `docs/design.md` - Detailed architecture and requirements document

## Development Workflow
1. The project is currently at starter template stage
2. Main implementation should focus on Cloudflare Worker development
3. Use `pnpm dev` for local development with tsx
4. Run tests with `pnpm test` (vitest)
5. Ensure code quality with `pnpm lint` before commits
6. Build for production with `pnpm build`

## Notes
- The project structure suggests this is preparation for a Cloudflare Worker implementation
- Current files are template placeholders; actual load balancer logic needs implementation
- Design document in `docs/design.md` contains the complete specification
- Target deployment is Cloudflare Workers with wrangler CLI