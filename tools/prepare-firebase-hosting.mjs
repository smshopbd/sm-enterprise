import { copyFile } from 'node:fs/promises';
import path from 'node:path';

const browserOutput = path.resolve('dist/app/browser');
await copyFile(
  path.join(browserOutput, 'index.csr.html'),
  path.join(browserOutput, 'index.html')
);

console.info('Prepared Firebase Hosting entry point.');
