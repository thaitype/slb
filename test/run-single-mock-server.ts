import { MockServer } from './mock-servers';

async function main() {
  console.log('Starting single mock origin server on port 9002...');
  
  const server = new MockServer({ port: 9002, delay: 100 });
  await server.start();
  
  console.log('Mock server running. Press Ctrl+C to stop.');
  
  process.on('SIGINT', async () => {
    console.log('\nStopping mock server...');
    await server.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\nStopping mock server...');
    await server.stop();
    process.exit(0);
  });
}

main().catch(console.error);