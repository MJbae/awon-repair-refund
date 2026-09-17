import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { calculate } from '../site/js/calculation.js';
import { formatPercentage } from '../site/js/format.js';

const temporary = await mkdtemp(join(tmpdir(),'awon-precision-'));
const mutations = process.argv.includes('--mutations');
try {
  const fixture = join(temporary,'cases.json');
  const python = spawnSync('python3',['tests/oracle/reference.py','--output',fixture,'--count','1536','--seed','20260917'],{encoding:'utf8',timeout:120000});
  if (python.error) throw new Error(`Python 3가 필요합니다: ${python.error.message}`);
  assert.equal(python.status,0,python.stderr);
  const dataset = JSON.parse(await readFile(fixture,'utf8'));
  const project = (result,expected) => Object.fromEntries(Object.keys(expected).map(key=>[key,result[key]]));
  for (const {name,input,expected} of dataset.valid) {
    const original = structuredClone(input);
    assert.deepEqual(project(calculate(input),expected),expected,name);
    assert.deepEqual(input,original,`${name}: input mutated`);
  }
  for (const {name,input} of dataset.invalid) assert.throws(()=>calculate(input),undefined,name);
  const building = JSON.parse(await readFile('site/data/building.json','utf8'));
  for (const check of dataset.metadata.ratioChecks) {
    const type = building.areaTypes.find(type=>type.id===building.unitTypes[check.unit]);
    assert.equal(type.supply,check.area,`${check.unit}: fixed area mapping`);
    assert.equal(formatPercentage(type.supply,building.totalSupply,2),check.percent2+'%');
    assert.equal(formatPercentage(type.supply,building.totalSupply,4),check.percent4+'%');
  }
  console.log(`Independent Python Fraction oracle: ${dataset.valid.length} valid cases, ${dataset.invalid.length} rejected inputs, ${dataset.metadata.coverage.rows} monthly rows; seed ${dataset.metadata.seed}; 0 mismatches.`);
  console.log(`14 unit ratios verified. ${dataset.metadata.coverage['subtotal-rounding-difference-cases']} split-subtotal rounding cases covered.`);

  if (mutations) {
    // Deliberately broken copies live only in the temporary directory.
    const source = await readFile('site/js/calculation.js','utf8');
    const definitions = [
      ['monthly rounding before adding',[['past = plus(past, value);','past = plus(past, fraction(BigInt(rounded(value))));']]],
      ['one day missing from partial month',[['usedDays = toDay - fromDay + 1;','usedDays = toDay - fromDay;']]],
      ['current month classified as future',[['month > asOfMonth','month >= asOfMonth']]],
      ['rounded percentage used for money',[['BigInt(area)','BigInt(Math.round(area / totalArea * 10000))'],['BigInt(totalArea)','10000n']]],
      ['future payments added to refund claim',[['claim: pastTotal - refunded','claim: pastTotal + rounded(future) - refunded']]],
      ['zero override ignored',[['if (Object.hasOwn(monthly, month))','if (monthly[month])']]],
      ['last month excluded',[['last - first + 1','last - first']]],
      ['every partial month assumed 30 days',[['BigInt(days)','30n']]],
      ['truncation instead of half-up rounding',[['Number((2n * a.n + a.d) / (2n * a.d))','Number(a.n / a.d)']]]
    ];
    for (const [index,[name,replacements]] of definitions.entries()) {
      let changed=source;
      for (const [before,after] of replacements) {
        assert(changed.includes(before),`Update mutation target after changing implementation: ${name}`);
        changed=changed.replaceAll(before,after);
      }
      const file=join(temporary,`mutation-${index}.mjs`);
      await writeFile(file,changed);
      const mutated=await import(pathToFileURL(file));
      let detected=false;
      for (const {input,expected} of dataset.valid) {
        try { assert.deepEqual(project(mutated.calculate(input),expected),expected); }
        catch { detected=true;break; }
      }
      assert(detected,`Independent oracle did not detect: ${name}`);
    }
    console.log(`Mutation check: detected ${definitions.length}/${definitions.length} deliberate arithmetic defects. Original source unchanged.`);
  }
} finally { await rm(temporary,{recursive:true,force:true}); }
