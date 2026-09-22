import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addMonths, calculate, currentMonth, daysInMonth, groupMonths, listMonths, parseArea, parseMoney, validateRanges } from '../site/js/calculation.js';

const json = async name => JSON.parse(await readFile(new URL(`../site/data/${name}.json`, import.meta.url), 'utf8'));
const defaults = await json('reserve-defaults');
const base = { start:'2024-10', end:'2026-09', asOfMonth:'2026-09', area:14968, totalArea:176307, defaults };

test('inclusive months, year transition and invalid ranges', () => {
  assert.equal(listMonths(base.start,base.end).length,24);
  assert.deepEqual(listMonths('2024-12','2024-12'),['2024-12']);
  assert.equal(addMonths('2024-10',23),'2026-09');
  assert.equal(addMonths('2026-09',-23),'2024-10');
  assert.throws(() => listMonths('2026-09','2026-08'));
  assert.throws(() => listMonths('2024-13','2026-09'));
  assert.throws(() => listMonths('1900-01','2200-01'));
});
test('current month uses Korea timezone, not host timezone', () => {
  assert.equal(currentMonth(new Date('2026-08-31T16:00:00Z')),'2026-09');
});
test('area and money parsing preserve hundredths and legitimate zero', () => {
  assert.equal(parseArea('149.68'),14968);
  assert.equal(parseArea('32.6'),3260);
  assert.equal(parseMoney('280,000'),280000);
  assert.equal(parseMoney('0'),0);
  for (const input of ['', '-1','NaN','1.2','1e3']) assert.throws(() => parseMoney(input));
  for (const input of ['0','1.001','-1']) assert.throws(() => parseArea(input));
});
test('24 months round once after exact summation', () => {
  const result = calculate(base);
  assert.equal(result.claim,407507);
  assert.equal(result.rows[0].amount,16979);
  assert.notEqual(result.claim,result.rows.reduce((n,r) => n+r.amount,0));
  assert.equal(calculate({...base,area:13510,totalArea:159129}).claim,407518);
});
test('36-month preset does not change the selected 24-month period', () => {
  assert.equal(calculate({...base,start:'2024-01',end:'2026-12',asOfMonth:'2026-12'}).claim,611261);
  assert.equal(calculate(base).count,24);
});
test('future months are separate even when actual amount was entered', () => {
  const result = calculate({...base,start:'2025-01',end:'2026-12'});
  assert.equal(result.pastTotal,356569);
  assert.equal(result.futureTotal,50938);
  assert.equal(result.total,407507);
  assert.equal(result.futureCount,3);
  const actual = calculate({...base,start:'2026-10',end:'2026-10',household:{'2026-10':{mode:'actual',amount:30000}}});
  assert.equal(actual.claim,0); assert.equal(actual.futureTotal,30000);
});
test('a rate change applies only within its inclusive period', () => {
  const result = calculate({...base,ranges:[{start:'2025-10',end:'2026-09',amount:300000}]});
  assert.equal(result.claim,509384);
  assert.equal(result.rows[11].reserve,200000); assert.equal(result.rows[12].reserve,300000);
});
test('overlapping ranges rejected; adjacent ranges allowed', () => {
  assert.throws(() => validateRanges([{start:'2024-01',end:'2024-05',amount:1},{start:'2024-05',end:'2024-06',amount:2}]));
  assert.doesNotThrow(() => validateRanges([{start:'2024-01',end:'2024-05',amount:1},{start:'2024-06',end:'2024-06',amount:2}]));
});
test('month > range > batch > preset including zero overrides', () => {
  const result = calculate({...base,start:'2024-01',end:'2024-04',batch:{'2024-01':100,'2024-02':100,'2024-03':100},ranges:[{start:'2024-02',end:'2024-03',amount:200}],monthly:{'2024-03':0}});
  assert.deepEqual(result.rows.map(r=>r.reserve),[100,200,0,200000]);
});
test('uncovered month stays missing; default never silently extends', () => {
  const result = calculate({...base,start:'2023-12',end:'2024-01'});
  assert.equal(result.claim,16979);
  assert.deepEqual(result.missingMonths,['2023-12']);
  assert.deepEqual(result.missingRanges,[{start:'2023-12',end:'2023-12'}]);
  assert.equal(result.rows[0].amount,null);
});
test('explicit actual zero resolves missing reserve/area; owner payments excluded', () => {
  const result = calculate({...base,start:'2023-11',end:'2023-12',area:null,household:{'2023-11':{mode:'owner'},'2023-12':{mode:'actual',amount:0}}});
  assert.equal(result.claim,0); assert.deepEqual(result.missingMonths,[]);
});
test('actual household payments work without area or building reserve', () => {
  const result = calculate({...base,start:'2023-11',end:'2023-12',area:null,household:{'2023-11':{mode:'actual',amount:10000},'2023-12':{mode:'actual',amount:20000}}});
  assert.equal(result.claim,30000); assert.equal(result.actualTotal,30000);
});
test('actual amounts replace estimates and do not get prorated again', () => {
  const result = calculate({...base,start:'2024-02',end:'2024-02',household:{'2024-02':{mode:'actual',amount:20000,partial:{fromDay:15,toDay:29}}}});
  assert.equal(result.claim,20000);
});
test('partial month is inclusive and handles leap years', () => {
  assert.equal(daysInMonth('2024-02'),29);
  assert.equal(daysInMonth('2025-02'),28);
  assert.equal(calculate({...base,start:'2024-02',end:'2024-02',household:{'2024-02':{partial:{fromDay:15,toDay:29}}}}).claim,8782);
  assert.throws(() => calculate({...base,start:'2025-02',end:'2025-02',household:{'2025-02':{partial:{fromDay:15,toDay:29}}}}));
});
test('refund is deducted from past months only, excessive refunds fail', () => {
  assert.equal(calculate({...base,refunded:10000}).claim,397507);
  assert.equal(calculate({...base,refunded:407507}).claim,0);
  assert.throws(() => calculate({...base,refunded:407508}));
  assert.throws(() => calculate({...base,start:'2026-10',end:'2026-12',refunded:1}));
});
test('period shrink and expansion do not mutate monthly overrides', () => {
  const monthly = {'2024-10':300000,'2026-09':310000};
  const original = structuredClone(monthly);
  calculate({...base,end:'2024-10',monthly});
  const result = calculate({...base,monthly});
  assert.deepEqual(monthly,original); assert.equal(result.rows.at(-1).reserve,310000);
});
test('bad inputs cannot become valid zero payments', () => {
  for (const amount of [NaN,Infinity,-1,0.1,undefined]) assert.throws(() => calculate({...base,monthly:{'2024-10':amount}}));
  assert.throws(() => calculate({...base,area:200000}));
  assert.throws(() => calculate({...base,totalArea:0}));
  assert.throws(() => calculate({...base,household:{'2024-10':{mode:'actual'}}}));
});
test('missing month grouping crosses year boundaries', () => {
  assert.deepEqual(groupMonths(['2023-12','2024-01','2024-03']),[{start:'2023-12',end:'2024-01'},{start:'2024-03',end:'2024-03'}]);
});
