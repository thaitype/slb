import { startMockServers, defaultMockConfig } from './mock-servers';

async function main() {
  console.log('Starting mock origin servers...');
  
  const servers = await startMockServers(defaultMockConfig);
  
  console.log('Mock servers running. Press Ctrl+C to stop.');
  
  process.on('SIGINT', async () => {
    console.log('\nStopping mock servers...');
    await Promise.all(servers.map(server => server.stop()));
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\nStopping mock servers...');
    await Promise.all(servers.map(server => server.stop()));
    process.exit(0);
  });
}

main().catch(console.error);