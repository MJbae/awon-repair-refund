import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import * as calc from '../site/js/calculation.js';
import * as output from '../site/js/format.js';

// DOM integration tests exercise the real app entry and user events.
// No external browser or network is required, and this is not visual QA.
async function setup(t, saved = null) {
  const window = new Window({url:'http://localhost:4173/awon-repair-refund/',settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true}});
  t.after(() => window.happyDOM.abort());
  const html = (await readFile(new URL('../site/index.html',import.meta.url),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
  window.document.write(html);
  Object.assign(window,calc,output,{ e:output.escapeHTML });
  window.HTMLElement.prototype.scrollIntoView = function() {};
  window.fetch = async url => ({ok:true,json:async()=>JSON.parse(await readFile(new URL(url),'utf8'))});
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
  const expected={101:['149.68','570,510'],102:['149.68','570,510'],201:['149.68','570,510'],202:['149.68','570,510'],301:['149.68','570,510'],302:['149.68','570,510'],401:['149.68','570,510'],402:['149.68','570,510'],501:['117.04','446,102'],502:['144.37','550,271'],601:['70.81','269,895'],602:['114.27','435,544'],701:['36.22','138,054'],702:['82.92','316,052']};
  for(const [unit,[area,amount]] of Object.entries(expected)) {
    change('unit',unit);submit();
    assert.equal($('result').hidden,false,unit);assert.equal($('claim-value').textContent,amount,unit);
    assert($('unit-area').textContent.includes(area),unit);
    assert.equal($('result-rows').children.length,24);
    assert.equal($('start-year').value,'2024');
  }
  assert.equal($('area-type'),null);assert.equal($('custom-area'),null);
});
test('rate override and invalid overlapping range do not discard valid entries',async t=>{
  const {$,change,period,submit}=await setup(t);
  change('unit','101');period();
  change('range-start-year','2025');change('range-start-month','10');change('range-end-year','2026');change('range-end-month','09');change('range-amount','300000');$('add-range').click();submit();
  assert.equal($('claim-value').textContent,'590,886');
  change('range-start-year','2026');change('range-start-month','01');change('range-end-year','2026');change('range-end-month','02');change('range-amount','320000');$('add-range').click();
  assert.equal($('options-error').hidden,false);assert.equal($('ranges-list').children.length,1);
});
test('uncovered months can explicitly inherit the default',async t=>{
  const {$,change,period,submit}=await setup(t);
  change('unit','101');period('2023-12','2024-01');submit();
  assert.match($('result-title').textContent,/부분 합계/);assert.equal($('claim-value').textContent,'23,771');
  $('missing-notice').querySelector('button').click();assert.equal($('claim-value').textContent,'47,543');
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
  change('unit','102');submit();assert.equal($('result').hidden,false);assert.equal($('claim-value').textContent,'23,771');
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
  assert.equal(result.claim,570510);assert.equal($('claim-value').textContent,'570,510');
  assert.throws(()=>tool.execute({unit:'201',start:'2026-09',end:'2024-10'}));
  assert.throws(()=>tool.execute({unit:'701',start:'2024-10',end:'2026-09',supplyArea:'149.68'}));
  assert.equal($('unit').value,'101');assert.equal($('claim-value').textContent,'570,510');
});

test('legacy saved values are not restored or allowed to override unit areas',async t=>{
  const saved=JSON.stringify({version:1,state:{unit:'701',start:'2024-10',end:'2026-09',areas:{701:{type:'custom',custom:'149.68'}},batch:{},ranges:[],monthly:{},households:{},refunds:{}}});
  const {window,$,change,period,submit}=await setup(t,saved);
  assert.equal($('unit').value,'');assert.equal($('start-year').value,'2024');
  assert.equal(window.localStorage.getItem('awon-repair-refund-v1'),saved);
  change('unit','701');period();
  submit();assert.equal($('claim-value').textContent,'138,054');assert.match($('unit-area').textContent,/36.22/);
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
