import { Logger } from '@nestjs/common';
import { createApp } from './app.factory';
import { config } from './config';

async function main() {
  const app = await createApp();
  const port = config().PORT;
  await app.listen(port, '0.0.0.0');
  Logger.log(`Andishkadeh API listening on :${port} (docs: /api/docs)`, 'Bootstrap');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
