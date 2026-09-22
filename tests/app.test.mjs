import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import * as calc from '../site/js/calculation.js';
import * as output from '../site/js/format.js';

// DOM integration tests exercise the real app entry and user events.
// No external browser or network is required, and this is not visual QA.
async function setup(t, saved = null, transformData = null) {
  const window = new Window({url:'http://localhost:4173/awon-repair-refund/',settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true}});
  t.after(() => window.happyDOM.abort());
  const html = (await readFile(new URL('../site/index.html',import.meta.url),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
  window.document.write(html);
  Object.assign(window,calc,output,{ e:output.escapeHTML });
  window.HTMLElement.prototype.scrollIntoView = function() {};
  window.fetch = async url => ({ok:true,json:async()=>{
    const data=JSON.parse(await readFile(new URL(url),'utf8'));
    return transformData ? transformData(new URL(url).pathname.split('/').at(-1),data) : data;
  }});
  const tools = new Map();
  window.document.modelContext = {registerTool(tool){tools.set(tool.name,tool);}};
  if (saved) window.localStorage.setItem('awon-repair-refund-v1',saved);
  const appURL = new URL('../site/js/app.js',import.meta.url);
  const script = (await readFile(appURL,'utf8')).replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(appURL.href));
  window.eval(script);
  for (let i=0;i<100 && window.document.getElementById('calculate-button').disabled;i++) await new Promise(resolve=>setTimeout(resolve,5));
  const $ = id => window.document.getElementById(id);
  assert.equal($('load-error').textContent,'');
  assert.equal($('calculate-button').disabled,false,'app should initialize');
  const change = (id,value,event='change') => { const el=typeof id==='string'?$(id):id; assert(el,`missing element: ${id}`); el.value=value; el.dispatchEvent(new window.Event(event,{bubbles:true})); };
  const submit = () => $('calculator').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  const period = (start='2024-10',end='2026-09') => {change('start-year',start.slice(0,4));change('start-month',start.slice(5));change('end-year',end.slice(0,4));change('end-month',end.slice(5));};
  const openMonths = () => {$('amount-options').open=true;$('monthly-details').open=true;$('monthly-details').dispatchEvent(new window.Event('toggle'));};
  return {window,$,change,submit,period,openMonths,tools};
}

test('first month auto-fills 24 months; later edits preserve opposite input',async t=>{
  const {$,change}=await setup(t);
  assert.equal($('start-year').value,'2024');
  assert.equal($('start-year').tagName,'SELECT');assert.equal($('end-year').tagName,'SELECT');
  change('start-month','10');
  assert.equal($('end-year').value,'2026');assert.equal($('end-month').value,'09');
  assert.match($('period-summary').textContent,/24개월/);
  change('start-month','11');assert.equal($('end-month').value,'09');
  assert.match($('period-summary').textContent,/23개월/);
  $('reset-duration').click();assert.equal($('end-month').value,'10');
});
test('end month can be entered first and reversed ranges stay visible',async t=>{
  const {$,change}=await setup(t);
  change('end-year','2026');change('end-month','09');
  assert.equal($('start-year').value,'2024');assert.equal($('start-month').value,'10');
  change('start-year','2027');
  assert.equal($('end-year').value,'2026');assert.equal($('period-error').hidden,false);
});
test('all units calculate with assigned areas and no area input',async t=>{
  const {$,change,period,submit}=await setup(t);
  period();
  const expected={101:['149.68','407,507'],102:['149.68','407,507'],201:['149.68','407,507'],202:['149.68','407,507'],301:['149.68','407,507'],302:['149.68','407,507'],401:['149.68','407,507'],402:['149.68','407,507'],501:['117.04','318,644'],502:['144.37','393,051'],601:['70.81','192,782'],602:['114.27','311,103'],701:['36.22','98,610'],702:['82.92','225,752']};
  for(const [unit,[area,amount]] of Object.entries(expected)) {
    change('unit',unit);submit();
    assert.equal($('result').hidden,false,unit);assert.equal($('claim-value').textContent,amount,unit);
    assert($('unit-area').textContent.includes(area),unit);
    assert.equal($('result-rows').children.length,24);
    assert.equal($('start-year').value,'2024');
  }
  assert.equal($('area-type'),null);assert.equal($('custom-area'),null);
});
test('monthly reserve choice defaults to 200000 and supports a custom amount',async t=>{
  const {window,$,change,period,submit,openMonths,tools}=await setup(t);
  assert.deepEqual([...$('reserve-choice').options].map(option=>option.value),['200000','custom']);
  assert.equal($('reserve-choice').value,'200000');
  assert.equal($('custom-reserve').hidden,true);
  change('unit','601');period('2024-01','2025-12');submit();
  assert.equal($('claim-value').textContent,'192,782');
  openMonths();change('reserve-choice','custom');
  assert.equal($('custom-reserve').hidden,false);
  assert.equal(window.document.activeElement,$('custom-reserve-amount'));
  change('custom-reserve-amount','300,000','input');
  assert.equal($('result').hidden,true);
  assert.equal($('reserve-heading').textContent,'300,000');
  assert.equal($('batch-amount').placeholder,'300,000');
  assert.equal($('month-editors').querySelector('[data-month-action="reserve"]').placeholder,'300,000');
  assert.match($('source-content').textContent,/300,000원/);
  assert.equal($('reserve-choice-note').hidden,true);
  submit();assert.equal($('claim-value').textContent,'289,173');
  assert.match($('result-rows').firstElementChild.textContent,/12,049/);
  assert.equal(tools.get('calculate_awon_refund').execute({unit:'601',start:'2024-01',end:'2025-12'}).claim,289173);
  change('reserve-choice','200000');
  assert.equal($('custom-reserve').hidden,true);
  assert.equal($('reserve-heading').textContent,'200,000');
  submit();assert.equal($('claim-value').textContent,'192,782');
  assert.match($('result-rows').firstElementChild.textContent,/8,033/);
  change('reserve-choice','custom');
  assert.equal($('custom-reserve-amount').value,'300,000');
  submit();assert.equal($('claim-value').textContent,'289,173');
  for (const invalid of ['', '20,00', '-1', '1.5', '1000000000001']) {
    change('custom-reserve-amount',invalid,'input');submit();
    assert.equal($('result').hidden,true,invalid);
    assert.equal($('custom-reserve-error').hidden,false,invalid);
    assert.equal($('custom-reserve-amount').getAttribute('aria-invalid'),'true');
    assert.equal($('reserve-heading').textContent,'금액 미입력');
    assert.throws(()=>tools.get('calculate_awon_refund').execute({unit:'101',start:'2024-01',end:'2025-12'}));
    assert.equal($('unit').value,'601');
  }
  change('reserve-choice','200000');submit();
  assert.equal($('custom-reserve-error').hidden,true);
  assert.equal($('claim-value').textContent,'192,782');
  change('reserve-choice','custom');change('custom-reserve-amount','0','input');submit();
  assert.equal($('custom-reserve-error').hidden,true);
  assert.equal($('custom-reserve-amount').hasAttribute('aria-invalid'),false);
  assert.equal($('claim-value').textContent,'0');
});
test('reserve choice preserves explicit monthly, range, batch and household adjustments',async t=>{
  const {window,$,change,period,openMonths,submit}=await setup(t);
  change('unit','601');period('2024-01','2024-05');
  change('reserve-choice','custom');change('custom-reserve-amount','300000','input');
  change('batch-amount','260000');$('apply-batch').click();
  change('range-start-year','2024');change('range-start-month','02');change('range-end-year','2024');change('range-end-month','02');change('range-amount','300000');$('add-range').click();
  openMonths();
  change($('month-editors').querySelector('[data-month="2024-01"] [data-month-action="reserve"]'),'310000','input');
  change($('month-editors').querySelector('[data-month="2024-03"] [data-month-action="mode"]'),'actual');
  change($('month-editors').querySelector('[data-month="2024-03"] [data-month-action="actual"]'),'12345','input');
  change($('month-editors').querySelector('[data-month="2024-04"] [data-month-action="mode"]'),'owner');
  change('refunded','1000','input');
  change('end-month','06');change('reserve-choice','200000');submit();
  assert.equal($('reserve-choice-note').hidden,false);
  assert.equal($('ranges-list').children.length,1);assert.equal($('refunded').value,'1000');
  const reserves=[...$('result-rows').children].map(row=>row.children[1].textContent);
  assert.deepEqual(reserves,['310,000','300,000','260,000','260,000','260,000','200,000']);
  assert.equal($('result-rows').children[2].children[2].textContent,'12,345');
  assert.equal($('result-rows').children[3].children[2].textContent,'0');
  assert.equal($('result').hidden,false);
});
test('choice uses the selected amount for explicit extensions outside the default dates',async t=>{
  const {$,change,period,submit}=await setup(t);
  change('unit','601');period('2023-12','2024-01');change('reserve-choice','custom');change('custom-reserve-amount','300000','input');submit();
  assert.match($('result-title').textContent,/부분 합계/);
  assert.equal($('claim-value').textContent,'12,049');
  const fill=$('missing-notice').querySelector('button');assert.match(fill.textContent,/300,000원/);
  fill.click();assert.equal($('claim-value').textContent,'24,098');
});
test('rate override and invalid overlapping range do not discard valid entries',async t=>{
  const {$,change,period,submit}=await setup(t);
  change('unit','101');period();
  change('range-start-year','2025');change('range-start-month','10');change('range-end-year','2026');change('range-end-month','09');change('range-amount','300000');$('add-range').click();submit();
  assert.equal($('claim-value').textContent,'509,384');
  change('range-start-year','2026');change('range-start-month','01');change('range-end-year','2026');change('range-end-month','02');change('range-amount','320000');$('add-range').click();
  assert.equal($('options-error').hidden,false);assert.equal($('ranges-list').children.length,1);
});
test('uncovered months can explicitly inherit the default',async t=>{
  const {$,change,period,submit}=await setup(t);
  change('unit','101');period('2023-11','2023-12');
  assert.equal($('reserve-heading').textContent,'금액 미입력');
  assert.equal($('reserve-unit-label').textContent,'');
  assert.equal($('reserve-badge').textContent,'전체 기간 금액 미입력');
  period('2023-12','2024-01');
  assert.equal($('reserve-heading').textContent,'200,000');
  assert.equal($('reserve-badge').textContent,'일부 기간 금액 미입력');
  submit();
  assert.match($('result-title').textContent,/부분 합계/);assert.equal($('claim-value').textContent,'16,979');
  $('missing-notice').querySelector('button').click();assert.equal($('claim-value').textContent,'33,959');
});
test('invalid month draft survives closing, reopening and period changes',async t=>{
  const {window,$,change,period,submit,openMonths}=await setup(t);
  change('unit','101');period('2024-10','2024-11');openMonths();
  const query=()=> $('month-editors').querySelector('[data-month="2024-10"] [data-month-action="reserve"]');
  change(query(),'-1');
  $('monthly-details').open=false;$('monthly-details').dispatchEvent(new window.Event('toggle'));
  openMonths();assert.equal(query().value,'-1');
  submit();assert.equal($('result').hidden,true);assert.match($('form-error').textContent,/2024년 10월/);
  change(query(),'300000');submit();assert.equal($('result').hidden,false);
});
test('household invalid drafts never leak into another unit',async t=>{
  const {window,$,change,period,submit,openMonths}=await setup(t);
  change('unit','101');period('2024-10','2024-10');openMonths();
  change($('month-editors').querySelector('[data-month-action="mode"]'),'actual');
  change($('month-editors').querySelector('[data-month-action="actual"]'),'-5');
  $('monthly-details').open=false;$('monthly-details').dispatchEvent(new window.Event('toggle'));
  change('unit','102');submit();assert.equal($('result').hidden,false);assert.equal($('claim-value').textContent,'16,979');
  change('unit','101');submit();assert.equal($('result').hidden,true);
});
test('actual-only calculation overrides the unit area and uses correct badge',async t=>{
  const {$,change,period,submit,openMonths}=await setup(t);
  change('unit','201');period('2024-10','2024-10');openMonths();
  change($('month-editors').querySelector('[data-month-action="mode"]'),'actual');
  change($('month-editors').querySelector('[data-month-action="actual"]'),'20000');submit();
  assert.equal($('claim-value').textContent,'20,000');assert.equal($('result').hidden,false);
  assert.equal($('result').querySelector('.result-badge').textContent,'직접 입력액 기준');
});
test('inputs stay in memory without storage controls or implicit writes',async t=>{
  const {window,$,change,period}=await setup(t);
  change('unit','101');period();assert.equal(window.localStorage.length,0);
  assert.equal($('remember'),null);assert.equal($('clear-storage'),null);assert.equal($('storage-status'),null);
  assert.equal($('unit').value,'101');
});
test('agent tool contract shares UI state and rejects invalid input atomically',async t=>{
  const {$,tools}=await setup(t);
  const tool=tools.get('calculate_awon_refund');assert(tool);
  const result=tool.execute({unit:'101',start:'2024-10',end:'2026-09'});
  assert.equal(result.claim,407507);assert.equal($('claim-value').textContent,'407,507');
  assert.throws(()=>tool.execute({unit:'201',start:'2026-09',end:'2024-10'}));
  assert.throws(()=>tool.execute({unit:'701',start:'2024-10',end:'2026-09',supplyArea:'149.68'}));
  assert.equal($('unit').value,'101');assert.equal($('claim-value').textContent,'407,507');
});

test('legacy saved values are not restored or allowed to override unit areas',async t=>{
  const saved=JSON.stringify({version:1,state:{unit:'701',start:'2024-10',end:'2026-09',areas:{701:{type:'custom',custom:'149.68'}},batch:{},ranges:[],monthly:{},households:{},refunds:{}}});
  const {window,$,change,period,submit}=await setup(t,saved);
  assert.equal($('unit').value,'');assert.equal($('start-year').value,'2024');
  assert.equal(window.localStorage.getItem('awon-repair-refund-v1'),saved);
  change('unit','701');period();
  submit();assert.equal($('claim-value').textContent,'98,610');assert.match($('unit-area').textContent,/36.22/);
});

test('details explain the selected calculation and legal basis is last',async t=>{
  const {window,$,change,period,submit}=await setup(t);
  change('unit','701');period();submit();
  assert.match($('monthly-preview').textContent,/24개월/);
  assert.match($('monthly-formula').textContent,/36.22㎡/);
  assert.equal($('result-detail').querySelector('summary').getAttribute('aria-controls'),'monthly-content');
  assert.equal($('source-details').querySelector('summary').getAttribute('aria-controls'),'source-content');
  assert.equal($('source-content').querySelectorAll('tbody tr').length,14);
  assert.equal(window.document.querySelector('main').lastElementChild.id,'legal-details');
  assert.equal($('legal-details').open,false);
  assert.match($('legal-details').querySelector('summary').textContent,/법적 근거/);
  assert.equal($('legal-details').querySelector('summary').getAttribute('aria-controls'),'legal-content');
  assert.equal($('copy-result'),null);assert.equal($('print-result'),null);assert.equal($('print-sheet'),null);
});

test('typing a monthly amount updates calculation before blur without replacing the input',async t=>{
  const {window,$,change,period,submit,openMonths}=await setup(t);
  change('unit','601');period('2024-01','2024-01');submit();
  assert.equal($('claim-value').textContent,'8,033');openMonths();
  const input=$('month-editors').querySelector('[data-month-action="reserve"]');input.focus();
  change(input,'560000','input');
  assert.equal($('result').hidden,true);
  assert.equal(window.document.activeElement,input);assert(input.isConnected);
  assert.match($('month-editors').querySelector('.reserve-source').textContent,/월별 수정/);
  submit();assert.equal($('claim-value').textContent,'22,491');
});
test('actual amount and partial days apply on input, without waiting for change',async t=>{
  const {window,$,change,period,submit,openMonths}=await setup(t);
  change('unit','601');period('2024-01','2024-01');openMonths();
  change($('month-editors').querySelector('[data-month-action="mode"]'),'actual');
  change($('month-editors').querySelector('[data-month-action="actual"]'),'15000','input');submit();
  assert.equal($('claim-value').textContent,'15,000');
  change($('month-editors').querySelector('[data-month-action="mode"]'),'estimate');
  const partial=$('month-editors').querySelector('[data-month-action="partial"]');partial.checked=true;partial.dispatchEvent(new window.Event('change',{bubbles:true}));
  const day=$('month-editors').querySelector('[data-month-action="fromDay"]');day.focus();change(day,'31','input');
  assert.equal(window.document.activeElement,day);submit();assert.equal($('claim-value').textContent,'259');
});
test('typed refund reaches tool calculation; invalid refund survives unit switching and recovers',async t=>{
  const {$,change,period,submit,tools}=await setup(t);
  change('unit','601');period('2024-01','2024-01');submit();
  change('refunded','1000','input');assert.equal($('result').hidden,true);
  const tool=tools.get('calculate_awon_refund');
  assert.equal(tool.execute({unit:'601',start:'2024-01',end:'2024-01'}).claim,7033);
  assert.equal($('refunded').value,'1000');
  change('refunded','-500','input');
  assert.throws(()=>tool.execute({unit:'601',start:'2024-01',end:'2024-01'}));
  assert.equal($('refunded').value,'-500');
  change('unit','101');assert.equal($('refunded').value,'');
  change('unit','601');assert.equal($('refunded').value,'-500');assert.equal($('refund-error').hidden,false);
  change('refunded','1000','input');assert.equal($('refund-error').hidden,true);
  submit();assert.equal($('claim-value').textContent,'7,033');assert.equal($('options-error').hidden,true);
});
test('failed submission cannot leave an earlier successful result visible',async t=>{
  const {$,change,period,submit}=await setup(t);
  change('unit','601');period('2024-01','2024-01');submit();assert.equal($('result').hidden,false);
  $('refunded').value='-1';submit();
  assert.equal($('result').hidden,true);assert.equal($('form-error').hidden,false);
});
test('an unfinished actual amount outside the selected period does not block valid months',async t=>{
  const {$,change,period,submit,openMonths}=await setup(t);
  change('unit','601');period('2024-01','2024-02');openMonths();
  change($('month-editors').querySelector('[data-month="2024-02"] [data-month-action="mode"]'),'actual');
  change('end-month','01');submit();assert.equal($('claim-value').textContent,'8,033');assert.equal($('result').hidden,false);
  change('end-month','02');submit();assert.equal($('result').hidden,true);assert.equal($('form-error').hidden,false);
});
test('owner-only calculation describes exclusion rather than payment or estimation',async t=>{
  const {$,change,period,submit,openMonths}=await setup(t);
  change('unit','601');period('2024-01','2024-01');openMonths();
  change($('month-editors').querySelector('[data-month-action="mode"]'),'owner');submit();
  assert.equal($('claim-value').textContent,'0');assert.match($('result-method').textContent,/제외/);
  assert.equal($('result').querySelector('.result-badge').textContent,'소유자 납부 제외');
  assert.match($('monthly-formula-title').textContent,/참고/);
});
test('displayed approximate ratio agrees with the precise 601 calculation',async t=>{
  const {$,change,period,submit}=await setup(t);
  change('unit','601');period('2024-01','2025-12');submit();
  assert.equal($('claim-value').textContent,'192,782');
  assert.match($('monthly-formula').textContent,/70\.81㎡ ÷ 1,763\.07㎡ ≈ 0\.04016290 \(약 4\.0163%\)/);
});
test('malformed money separators remain visible as errors instead of calculating another amount',async t=>{
  const {$,change,period,submit,openMonths}=await setup(t);
  change('unit','601');period('2024-01','2024-01');openMonths();
  const input=$('month-editors').querySelector('[data-month-action="reserve"]');
  change(input,'28,00','input');submit();assert.equal($('result').hidden,true);assert.equal($('form-error').hidden,false);
  const replacement=$('month-editors').querySelector('[data-month-action="reserve"]');
  assert.equal(replacement.value,'28,00');change(replacement,'200,000','input');submit();assert.equal($('claim-value').textContent,'8,033');
});
test('formula labels follow data changes instead of hardcoded area and reserve values',async t=>{
  const {$,change,period,submit}=await setup(t,null,(file,data)=>{
    if(file==='building.json') {data.totalSupply*=2;for(const type of data.areaTypes) type.supply*=2;}
    if(file==='reserve-defaults.json') {data.amount=300000;data.from='2023-01';data.to='2025-12';}
    return data;
  });
  assert.deepEqual([...$('reserve-choice').options].map(option=>option.value),['300000','custom']);
  assert.match($('source-content').textContent,/3,526.14㎡/);assert.match($('source-content').textContent,/300,000원/);assert.match($('source-content').textContent,/2023년 1월/);
  change('unit','601');period('2024-01','2024-01');submit();
  assert.equal($('claim-value').textContent,'12,049');assert.match($('monthly-formula').textContent,/141.62㎡ ÷ 3,526.14㎡/);
});
