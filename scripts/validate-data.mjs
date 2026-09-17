import assert from 'node:assert/strict';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const json = async name => JSON.parse(await readFile(`site/data/${name}.json`, 'utf8'));
const [building, defaults, observations, legal] = await Promise.all(['building','reserve-defaults','reserve-observations','legal'].map(json));
assert.equal(new Set(building.units).size, 14);
assert.equal(building.areaTypes.reduce((n, a) => n + a.count, 0), 14);
assert.equal(building.areaTypes.reduce((n, a) => n + a.supply * a.count, 0), building.totalSupply);
assert.equal(building.areaTypes.reduce((n, a) => n + a.exclusive * a.count, 0), building.totalExclusive);
assert.equal(building.totalSupply, 176307);
assert.deepEqual(Object.keys(building.unitTypes).sort(), [...building.units].sort());
const unitAreas = building.units.map(unit => building.areaTypes.find(type => type.id === building.unitTypes[unit]));
assert(unitAreas.every(Boolean), 'Every unit must map to a known area type');
assert.equal(unitAreas.reduce((sum,type) => sum + type.supply,0), building.totalSupply);
for (const type of building.areaTypes) assert.equal(unitAreas.filter(area => area.id === type.id).length, type.count);
assert.equal(defaults.from, '2024-01');
assert.equal(defaults.to, '2026-12');
assert.equal(defaults.amount, 280000);
assert.equal(defaults.status, 'assumption');
assert.equal(observations.length, 3);
assert(observations.every(row => row.billingMonth === null && row.status === 'observed-withdrawal'));
assert.equal(legal.entries.length, 2);
assert(legal.entries.every(entry => new URL(entry.url).hostname === 'law.go.kr' && entry.quote.length > 20));
const html = await readFile('site/index.html', 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(ids.length, new Set(ids).size, 'Duplicate HTML ids');
for (const reference of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)) assert((await lstat(resolve('site', reference[1]))).isFile());
for (const file of await readdir('site/js')) {
  if (extname(file) !== '.js') continue;
  const result = spawnSync(process.execPath, ['--check', `site/js/${file}`], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
}
console.log('Data verified: 14 units, area totals, separate assumptions/observations, legal sources, assets and JavaScript syntax.');
