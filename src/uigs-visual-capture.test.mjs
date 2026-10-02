import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const contract = JSON.parse(await readFile(new URL('../.uigs/ui-visual-capture.json', import.meta.url), 'utf8'));
const inventory = JSON.parse(await readFile(new URL('../.uigs/ui-surfaces.json', import.meta.url), 'utf8'));
const captured = new Set(contract.captures.flatMap((capture) => capture.surface_ids));
const declared = new Set(inventory.surfaces.map((surface) => surface.id));
assert.deepEqual([...captured].sort(), [...declared].sort());
assert.ok(contract.captures.some((capture) => capture.fixture?.state === 'manual-media'));
assert.ok(contract.captures.some((capture) => capture.fixture?.state === 'mobile-produce'));
console.log('UIGS visual capture contract covers all QHE UI surfaces.');
