import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('public', { recursive: true });
await copyFile('node_modules/coi-serviceworker/coi-serviceworker.js', 'public/coi-serviceworker.js');
console.log('Copied coi-serviceworker.js to public/.');
