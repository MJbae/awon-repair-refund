import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculate, daysInMonth, parseMoney, MAX_MONEY } from '../site/js/calculation.js';
import { formatArea, formatFraction, formatPercentage } from '../site/js/format.js';

const building=JSON.parse(await readFile(new URL('../site/data/building.json',import.meta.url),'utf8'));
const base={start:'2024-01',end:'2025-12',asOfMonth:'2026-09',area:7081,totalArea:176307,defaults:{from:'2024-01',to:'2026-12',amount:280000}};
const units={101:14968,102:14968,201:14968,202:14968,301:14968,302:14968,401:14968,402:14968,501:11704,502:14437,601:7081,602:11427,701:3622,702:8292};

test('all fourteen units conserve the exact building area and unrounded allocation',()=>{
  assert.deepEqual(Object.fromEntries(building.units.map(unit=>[unit,building.areaTypes.find(t=>t.id===building.unitTypes[unit]).supply])),units);
  assert.equal(Object.values(units).reduce((a,b)=>a+b,0),176307);
  for(const amount of [0,1,280000,300000,MAX_MONEY]) {
    const totalNumerator=Object.values(units).reduce((sum,area)=>sum+BigInt(amount)*BigInt(area),0n);
    assert.equal(totalNumerator,BigInt(amount)*176307n);
    const result=calculate({...base,area:176307,end:'2024-01',defaults:{...base.defaults,amount}});
    assert.equal(result.claim,amount);
  }
});
test('601 ratio is correct; display percent is never used to calculate payments',()=>{
  assert.equal(formatFraction(7081,176307,8),'0.04016290');
  assert.equal(formatPercentage(7081,176307,2),'4.02%');
  assert.equal(formatPercentage(7081,176307,4),'4.0163%');
  const result=calculate(base);
  assert.equal(result.claim,269895);
  assert.equal(result.rounding.pastDisplaySum,269904);
  assert.equal(result.rounding.pastAdjustment,-9);
  const incorrectRoundedPercent=280000*402/10000*24;
  assert.equal(incorrectRoundedPercent,270144);
  assert.equal(incorrectRoundedPercent-result.claim,249);
});
test('all seven display ratios use exact integer rounding',()=>{
  const expected=[[3622,'2.05%','2.0544%'],[7081,'4.02%','4.0163%'],[8292,'4.70%','4.7032%'],[11427,'6.48%','6.4813%'],[11704,'6.64%','6.6384%'],[14437,'8.19%','8.1886%'],[14968,'8.49%','8.4897%']];
  for(const [area,two,four] of expected) {assert.equal(formatPercentage(area,176307,2),two);assert.equal(formatPercentage(area,176307,4),four);}
  assert.equal(formatArea(176307),'1,763.07');
  assert.equal(formatArea(Number.MAX_SAFE_INTEGER),'90,071,992,547,409.91');
  assert.equal(formatPercentage(Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER),'100.0000%');
  assert.equal(formatFraction(1,2,0),'1');
  assert.equal(formatPercentage(1,32,2),'3.13%');
  for(const args of [[1,0,2],[-1,2,2],[1,2,13],[0.5,2,2]]) assert.throws(()=>formatFraction(...args));
});
test('a half-won rounds up but half-won months are not rounded before summing',()=>{
  const values=[[4999,0],[5000,1],[5001,1]];
  for(const [area,expected] of values) assert.equal(calculate({...base,start:'2024-01',end:'2024-01',area,totalArea:10000,defaults:{...base.defaults,amount:1}}).claim,expected);
  const result=calculate({...base,end:'2024-02',area:1,totalArea:2,defaults:{...base.defaults,amount:1}});
  assert.equal(result.claim,1);assert.equal(result.rounding.pastDisplaySum,2);assert.equal(result.rounding.pastAdjustment,-1);
});
test('paid and future subtotals disclose their independent rounding remainder',()=>{
  const result=calculate({...base,end:'2024-02',asOfMonth:'2024-01',area:1,totalArea:2,defaults:{...base.defaults,amount:1}});
  assert.equal(result.pastTotal,1);assert.equal(result.futureTotal,1);assert.equal(result.total,1);
  assert.equal(result.rounding.splitTotalAdjustment,-1);
  assert.equal(result.actualTotal+result.estimatedTotal,result.pastTotal);
});
test('whole-building rounded household totals have bounded rounding residues',()=>{
  const oneMonth=Object.values(units).reduce((sum,area)=>sum+calculate({...base,area,end:'2024-01'}).claim,0);
  const twoYears=Object.values(units).reduce((sum,area)=>sum+calculate({...base,area}).claim,0);
  assert.equal(oneMonth,279999);assert.equal(twoYears,6719998);
  assert(Math.abs(oneMonth-280000)<=7);assert(Math.abs(twoYears-280000*24)<=7);
});
test('century leap years, 28/29/30/31-day months and one-day boundaries',()=>{
  assert.equal(daysInMonth('1900-02'),28);assert.equal(daysInMonth('2000-02'),29);assert.equal(daysInMonth('2100-02'),28);
  for(const [month,days] of [['2024-01',31],['2024-02',29],['2025-02',28],['2024-04',30]]) {
    assert.equal(daysInMonth(month),days);
    const result=calculate({...base,start:month,end:month,area:176307,defaults:{from:month,to:month,amount:days},household:{[month]:{partial:{fromDay:days,toDay:days}}}});
    assert.equal(result.claim,1);assert.equal(result.rows[0].usedDays,1);
  }
});
test('maximum supported duration and money stay within exact safe integer totals',()=>{
  const result=calculate({...base,start:'1900-01',end:'1949-12',asOfMonth:'2200-12',area:Number.MAX_SAFE_INTEGER,totalArea:Number.MAX_SAFE_INTEGER,defaults:{from:'1900-01',to:'1949-12',amount:MAX_MONEY}});
  assert.equal(result.count,600);assert.equal(result.claim,600000000000000);assert(Number.isSafeInteger(result.claim));
  assert.throws(()=>calculate({...base,defaults:{...base.defaults,amount:MAX_MONEY+1}}));
});
test('money input rejects misplaced separators instead of silently changing the amount',()=>{
  for(const text of ['28,00','1,2,3','2,,80000','280,000,',',280000','280 000','1.000','1e3','0,001']) assert.throws(()=>parseMoney(text),undefined,text);
  for(const [text,expected] of [['280000',280000],['280,000',280000],['1,000,000',1000000],[' 1,000 ',1000],['0',0],['0001',1]]) assert.equal(parseMoney(text),expected);
});
test('malformed defaults and adjustment records cannot silently fall back to estimates',()=>{
  for(const defaults of [[],true,'280000',{from:'0000-00',to:'9999-99',amount:1},{from:'2025-01',to:'2024-01',amount:1},{from:'2024-01',amount:1}]) assert.throws(()=>calculate({...base,defaults}));
  for(const entry of [null,123,'owner',[],{mode:false},{mode:null},{mode:''},{partial:null}]) assert.throws(()=>calculate({...base,household:{'2024-01':entry}}));
  for(const map of [null,[],true,'1000']) assert.throws(()=>calculate({...base,monthly:map}));
  assert.throws(()=>calculate({...base,monthly:{'2024-1':1000}}));
  assert.throws(()=>calculate({...base,household:{'2024-00':{mode:'owner'}}}));
  assert.throws(()=>calculate({...base,ranges:null}));
});
test('actual amounts and owner exclusions do not apply the area or partial-day ratio twice',()=>{
  const result=calculate({...base,start:'2024-02',end:'2024-03',household:{'2024-02':{mode:'actual',amount:12345,partial:{fromDay:15,toDay:29}},'2024-03':{mode:'owner',amount:99999}}});
  assert.equal(result.claim,12345);assert.equal(result.actualTotal,12345);assert.equal(result.estimatedTotal,0);
});
test('fully frozen configuration remains unchanged through sorting and calculation',()=>{
  const input=structuredClone({...base,ranges:[{start:'2024-03',end:'2024-04',amount:300000},{start:'2024-01',end:'2024-02',amount:290000}],household:{'2024-01':{partial:{fromDay:2,toDay:31}}}});
  function freeze(obj){for(const value of Object.values(obj)) if(value && typeof value==='object') freeze(value);return Object.freeze(obj);}
  freeze(input);assert.doesNotThrow(()=>calculate(input));assert.equal(input.ranges[0].start,'2024-03');
});
