import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { loadEnvFile } from './config/load-env';

// The environment must be in place before anything reads configuration, so the
// application module is pulled in dynamically rather than as a hoisted import.
loadEnvFile();

void (async () => {
  try {
    const { bootstrap } = await import('./bootstrap');
    await bootstrap();
  } catch (err) {
    // Startup failures print to the server console and stop the process. A
    // Vault that starts with a broken configuration is worse than one that
    // refuses to start at all.
    new Logger('Vault').error(
      `Startup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
})();
