import { performance } from 'perf_hooks';

interface BenchmarkResult {
  totalRequests: number;
  totalTime: number;
  averageLatency: number;
  minLatency: number;
  maxLatency: number;
  requestsPerSecond: number;
  successfulRequests: number;
  failedRequests: number;
}

async function measureLatency(url: string): Promise<number> {
  const start = performance.now();
  try {
    const response = await fetch(url);
    const end = performance.now();
    return response.ok ? end - start : -1;
  } catch (error) {
    return -1;
  }
}

async function benchmark(
  url: string, 
  requests: number = 100, 
  concurrent: number = 10
): Promise<BenchmarkResult> {
  console.log(`Benchmarking ${url} with ${requests} requests (${concurrent} concurrent)`);
  
  const startTime = performance.now();
  const latencies: number[] = [];
  let successfulRequests = 0;
  let failedRequests = 0;
  
  // Run requests in batches to control concurrency
  for (let i = 0; i < requests; i += concurrent) {
    const batch = Math.min(concurrent, requests - i);
    const promises = Array(batch).fill(0).map(() => measureLatency(url));
    
    const results = await Promise.all(promises);
    
    for (const latency of results) {
      if (latency > 0) {
        latencies.push(latency);
        successfulRequests++;
      } else {
        failedRequests++;
      }
    }
    
    // Small delay between batches to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  const endTime = performance.now();
  const totalTime = endTime - startTime;
  
  if (latencies.length === 0) {
    throw new Error('All requests failed');
  }
  
  const averageLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);
  const requestsPerSecond = (successfulRequests / totalTime) * 1000;
  
  return {
    totalRequests: requests,
    totalTime,
    averageLatency,
    minLatency,
    maxLatency,
    requestsPerSecond,
    successfulRequests,
    failedRequests
  };
}

function printResults(name: string, result: BenchmarkResult) {
  console.log(`\n=== ${name} ===`);
  console.log(`Total requests: ${result.totalRequests}`);
  console.log(`Successful: ${result.successfulRequests}, Failed: ${result.failedRequests}`);
  console.log(`Total time: ${result.totalTime.toFixed(2)}ms`);
  console.log(`Average latency: ${result.averageLatency.toFixed(2)}ms`);
  console.log(`Min latency: ${result.minLatency.toFixed(2)}ms`);
  console.log(`Max latency: ${result.maxLatency.toFixed(2)}ms`);
  console.log(`Requests per second: ${result.requestsPerSecond.toFixed(2)}`);
}

async function main() {
  const LOAD_BALANCER_URL = 'http://localhost:8787/api/test';
  const DIRECT_ORIGIN_URL = 'http://localhost:9001/api/test';
  
  console.log('🚀 Load Balancer Performance Benchmark\n');
  
  try {
    // Wait for services to be ready
    console.log('Checking if services are ready...');
    await measureLatency(LOAD_BALANCER_URL);
    await measureLatency(DIRECT_ORIGIN_URL);
    console.log('Services are ready!\n');
    
    // Benchmark direct origin
    console.log('Benchmarking direct origin server...');
    const directResult = await benchmark(DIRECT_ORIGIN_URL, 50, 5);
    printResults('Direct Origin', directResult);
    
    // Benchmark load balancer
    console.log('\nBenchmarking load balancer...');
    const lbResult = await benchmark(LOAD_BALANCER_URL, 50, 5);
    printResults('Load Balancer', lbResult);
    
    // Calculate overhead
    const overhead = lbResult.averageLatency - directResult.averageLatency;
    const overheadPercentage = (overhead / directResult.averageLatency) * 100;
    
    console.log(`\n=== Performance Analysis ===`);
    console.log(`Load balancer overhead: ${overhead.toFixed(2)}ms (${overheadPercentage.toFixed(1)}%)`);
    
    if (overhead < 10) {
      console.log('✅ Excellent performance! Overhead is minimal.');
    } else if (overhead < 50) {
      console.log('⚠️  Moderate overhead. Consider optimizations.');
    } else {
      console.log('❌ High overhead. Performance optimization needed.');
    }
    
  } catch (error) {
    console.error('Benchmark failed:', error);
    console.log('\nMake sure both services are running:');
    console.log('1. pnpm mock:servers');
    console.log('2. pnpm dev');
  }
}

if (require.main === module) {
  main().catch(console.error);
}