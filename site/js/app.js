import { addMonths, calculate, currentMonth, daysInMonth, formatMonth, listMonths, monthIndex, parseMoney, reserveForMonth, validateRanges } from './calculation.js';
import { escapeHTML as e, won, formatArea, formatFraction, formatPercentage } from './format.js';

const $ = id => document.getElementById(id);
const BASE_YEAR = 2024;
const periodTouched = {start:false,end:false};
const state = { unit:'', start:'', end:'', batch:{}, ranges:[], monthly:{}, households:{}, refunds:{}, refundInputs:{}, drafts:{reserve:{},households:{}} };
let building, defaults, legal, currentResult = null;
const setMessage = (id, message = '') => { $(id).textContent = message; $(id).hidden = !message; };
const dataURL = file => new URL(`../data/${file}.json`, import.meta.url);

async function init() {
  [building, defaults, legal] = await Promise.all(['building', 'reserve-defaults', 'legal'].map(async file => {
    const response = await fetch(dataURL(file));
    if (!response.ok) throw new Error('기본 자료를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.');
    return response.json();
  }));
  $('unit').insertAdjacentHTML('beforeend', building.units.map(unit => `<option value="${unit}">${unit}호</option>`).join(''));
  for (const prefix of ['start','end','range-start','range-end']) {
    $(`${prefix}-year`).innerHTML = Array.from({length:21}, (_, i) => BASE_YEAR - 10 + i).map(year => `<option value="${year}">${year}년</option>`).join('');
    $(`${prefix}-year`).value = String(BASE_YEAR);
    $(`${prefix}-month`).insertAdjacentHTML('beforeend', Array.from({length:12}, (_, i) => `<option value="${String(i + 1).padStart(2, '0')}">${i + 1}월</option>`).join(''));
  }
  renderLegal();
  bind();
  syncForm();
  $('calculate-button').disabled = false;
  registerAgentTool();
}

function activeHousehold() {
  if (!state.unit) return {};
  return state.households[state.unit] ||= {};
}
function selectedHousehold(unit,start,end) {
  return Object.fromEntries(Object.entries(state.households[unit] || {}).filter(([month]) => start <= month && month <= end));
}
function refundFor(unit) {
  const raw = state.refundInputs[unit];
  return raw === undefined ? state.refunds[unit] || 0 : raw.trim() ? parseMoney(raw,'반환받은 금액') : 0;
}
function renderRefundInput() {
  $('refunded').value = state.refundInputs[state.unit] ?? (state.refunds[state.unit] ? won(state.refunds[state.unit]) : '');
  try { refundFor(state.unit); setMessage('refund-error'); }
  catch(error) { setMessage('refund-error',error.message); }
}
function dirty() {
  currentResult = null;
  $('result').hidden = true;
  setMessage('form-error');
  renderAmountHeading();
}
function readMonth(prefix) {
  const year = $(`${prefix}-year`).value.trim();
  const month = $(`${prefix}-month`).value;
  return year.length === 4 && month ? `${year}-${month}` : '';
}
function writeMonth(prefix, month) {
  const year = month ? month.slice(0,4) : String(BASE_YEAR);
  const select = $(`${prefix}-year`);
  if (![...select.options].some(option => option.value === year)) {
    select.add(new Option(`${year}년`,year));
    [...select.options].sort((a,b) => Number(a.value)-Number(b.value)).forEach(option => select.append(option));
  }
  select.value = year;
  $(`${prefix}-month`).value = month ? month.slice(5) : '';
}
function periodChanged(prefix) {
  periodTouched[prefix] = true;
  state[prefix] = readMonth(prefix);
  const other = prefix === 'start' ? 'end' : 'start';
  const otherEmpty = !state[other] && !periodTouched[other];
  if (state[prefix] && otherEmpty) {
    try { state[other] = addMonths(state[prefix], prefix === 'start' ? 23 : -23); writeMonth(other, state[other]); } catch { /* Inline period validation below. */ }
  }
  dirty(); renderPeriod(); renderMonthEditors();
}
function renderPeriod() {
  setMessage('period-error');
  if (!state.start || !state.end) { $('period-summary').textContent = '한쪽 월을 고르면 기본 24개월로 채워드려요.'; return; }
  try {
    const months = listMonths(state.start, state.end);
    const future = months.filter(month => month > currentMonth()).length;
    $('period-summary').innerHTML = `${e(formatMonth(state.start))}~${e(formatMonth(state.end))} · <strong>총 ${months.length}개월</strong><br>양 끝 월 포함${future ? ` · 향후 ${future}개월 포함` : ''}`;
  } catch (error) { $('period-summary').textContent = '기간을 확인해 주세요.'; setMessage('period-error', error.message); }
}
function unitType(unit = state.unit) { return building.areaTypes.find(type => type.id === building.unitTypes[unit]); }
function selectedArea(unit = state.unit) { return unitType(unit)?.supply ?? null; }
function renderUnitArea() {
  const type = unitType();
  $('unit-area').hidden = !type;
  $('unit-area').innerHTML = type ? `<span class="sr-only">선택한 호수의 공급면적 </span>${(type.supply / 100).toFixed(2)}㎡${type.variant ? `<small>${e(type.variant)}타입</small>` : ''}` : '';
}
function syncForm() {
  $('unit').value = state.unit;
  writeMonth('start', state.start); writeMonth('end', state.end);
  renderRefundInput();
  renderUnitArea(); renderPeriod(); renderRanges(); renderMonthEditors(); renderAmountHeading();
}
function renderRanges() {
  $('ranges-list').innerHTML = state.ranges.map((range, index) => `<div class="range-row"><div>${e(range.start)}~${e(range.end)}<strong>월 ${won(range.amount)}원</strong></div><button type="button" data-delete-range="${index}" aria-label="${e(range.start)}부터 ${e(range.end)} 금액 변경 삭제">삭제</button></div>`).join('');
}
function reserveFor(month) { return reserveForMonth(month, { defaults, batch:state.batch, ranges:state.ranges, monthly:state.monthly }); }

function renderAmountHeading() {
  let reserves = [];
  try { reserves = listMonths(state.start,state.end).map(reserveFor); } catch { /* Empty or incomplete range uses preset label. */ }
  const amounts = [...new Set(reserves.filter(r => r.amount !== null).map(r => r.amount))];
  const mixed = amounts.length > 1;
  const allMissing = reserves.length > 0 && amounts.length === 0;
  $('reserve-heading').textContent = allMissing ? '금액 미입력' : mixed ? '기간별로 다름' : won(amounts[0] ?? defaults.amount);
  $('reserve-unit-label').textContent = mixed || allMissing ? '' : ' 원';
  $('reserve-badge').textContent = allMissing ? '전체 기간 금액 미입력' : reserves.some(r => r.amount === null) ? '일부 기간 금액 미입력' : reserves.some(r => r.source !== '기본 가정') ? '수정 금액 적용' : `${defaults.from.slice(0,4)}~${defaults.to.slice(0,4)} 기본값`;
}

function householdDrafts() { return state.drafts.households[state.unit] ||= {}; }
function draftsFor(month) {
  return { ...(householdDrafts()[month] || {}), ...(state.drafts.reserve[month] ? {reserve:state.drafts.reserve[month]} : {}) };
}
function clearDraft(month, action) {
  if (action === 'reserve') delete state.drafts.reserve[month];
  else if (householdDrafts()[month]) delete householdDrafts()[month][action];
}
function saveDraft(month, action, value, message) {
  if (action === 'reserve') state.drafts.reserve[month] = {value,message};
  else { householdDrafts()[month] ||= {}; householdDrafts()[month][action] = {value,message}; }
}

function renderMonthEditors() {
  if (!$('monthly-details').open) return;
  let months;
  try { months = listMonths(state.start, state.end); } catch { $('month-editors').innerHTML = '<p class="help">납부 기간을 먼저 선택해 주세요.</p>'; return; }
  const openMonths = new Set([...$('month-editors').querySelectorAll('details[open]')].map(el => el.dataset.month));
  const household = activeHousehold();
  $('month-editors').innerHTML = months.map(month => {
    const reserve = reserveFor(month), row = household[month] || {}, mode = row.mode || 'estimate';
    const partial = row.partial, maxDay = daysInMonth(month), draft = draftsFor(month);
    const invalid = action => draft[action] ? 'aria-invalid="true"' : '';
    return `<details class="month-item" data-month="${month}" ${openMonths.has(month) ? 'open' : ''}><summary>${e(formatMonth(month))}<span class="month-value">${reserve.amount === null ? '금액 미입력' : `전체 ${won(reserve.amount)}원`}</span></summary><div class="month-controls">
      <label>전체 월 적립액<input data-month-action="reserve" inputmode="numeric" value="${e(draft.reserve?.value ?? (Object.hasOwn(state.monthly, month) ? won(state.monthly[month]) : ''))}" ${invalid('reserve')} placeholder="${reserve.amount === null ? '금액 입력' : won(reserve.amount)}" aria-label="${month} 전체 월 적립액"></label>
      <p class="help reserve-source">${e(reserve.source)} · 비우면 기존 설정 적용</p>
      <label>우리 집 납부 방식<select data-month-action="mode" aria-label="${month} 납부 방식"><option value="estimate" ${mode === 'estimate' ? 'selected' : ''}>면적 비례로 계산</option><option value="actual" ${mode === 'actual' ? 'selected' : ''}>세대 실제 납부액 직접 입력</option><option value="owner" ${mode === 'owner' ? 'selected' : ''}>소유자 직접 납부 · 제외</option></select></label>
      ${mode === 'actual' ? `<label>우리 집 장기수선비<input data-month-action="actual" inputmode="numeric" value="${e(draft.actual?.value ?? (Number.isSafeInteger(row.amount) ? won(row.amount) : ''))}" ${invalid('actual')} placeholder="예: 23,771" aria-label="${month} 우리 집 실제 납부액"></label><p class="help">관리비 전체가 아닌 장기수선비만 입력하세요.</p>` : ''}
      ${mode === 'estimate' ? `<label class="checkbox-label"><input type="checkbox" data-month-action="partial" ${partial ? 'checked' : ''}>이 달은 일부 기간만 계산</label>${partial ? `<div class="day-range"><label>시작일<input type="number" min="1" max="${maxDay}" data-month-action="fromDay" value="${e(draft.fromDay?.value ?? partial.fromDay)}" ${invalid('fromDay')} aria-label="${month} 일할 시작일"></label><span>~</span><label>마지막 일<input type="number" min="1" max="${maxDay}" data-month-action="toDay" value="${e(draft.toDay?.value ?? partial.toDay)}" ${invalid('toDay')} aria-label="${month} 일할 마지막 일"></label></div><p class="help">양 끝 날짜 포함 / 이 달의 ${maxDay}일 기준으로 나눕니다.</p>` : ''}` : ''}
      <button type="button" class="text-button month-reset" data-month-action="reset">이 달 수정 취소</button><p class="error month-error" ${Object.keys(draft).length ? '' : 'hidden'}>${e(Object.values(draft).map(d => d.message).join(' '))}</p></div></details>`;
  }).join('');
}

function optionAction(action) {
  try { action(); dirty(); renderRanges(); renderMonthEditors(); setMessage('options-error'); $('options-status').textContent = '금액 설정을 반영했어요. 정산액을 다시 계산해 주세요.'; }
  catch(error) { setMessage('options-error', error.message); }
}
function bind() {
  $('unit').addEventListener('change', () => {
    state.unit = $('unit').value;
    setMessage('unit-error'); dirty(); renderUnitArea(); renderMonthEditors();
    renderRefundInput();
  });
  for (const prefix of ['start','end']) {
    $(`${prefix}-year`).addEventListener('change', () => periodChanged(prefix));
    $(`${prefix}-month`).addEventListener('change', () => periodChanged(prefix));
  }
  $('reset-duration').addEventListener('click', () => {
    try { state.end = addMonths(state.start, 23); writeMonth('end', state.end); dirty(); renderPeriod(); renderMonthEditors(); }
    catch { setMessage('period-error', '시작 연도와 월을 먼저 선택해 주세요.'); $('start-year').focus(); }
  });
  $('apply-batch').addEventListener('click', () => optionAction(() => {
    const months = listMonths(state.start, state.end);
    const amount = parseMoney($('batch-amount').value);
    for (const month of months) state.batch[month] = amount;
    if ($('replace-overrides').checked) {
      for (const month of months) { delete state.monthly[month]; delete state.drafts.reserve[month]; }
      state.ranges = state.ranges.flatMap(range => {
        if (range.end < state.start || range.start > state.end) return [range];
        const parts = [];
        if (range.start < state.start) parts.push({ ...range, end:addMonths(state.start, -1) });
        if (range.end > state.end) parts.push({ ...range, start:addMonths(state.end, 1) });
        return parts;
      });
    }
  }));
  $('add-range').addEventListener('click', () => optionAction(() => {
    const range = { start:readMonth('range-start'), end:readMonth('range-end'), amount:parseMoney($('range-amount').value) };
    validateRanges([...state.ranges, range]);
    state.ranges.push(range); state.ranges.sort((a,b) => a.start.localeCompare(b.start));
    writeMonth('range-start',''); writeMonth('range-end',''); $('range-amount').value = '';
  }));
  $('ranges-list').addEventListener('click', event => {
    const button = event.target.closest('[data-delete-range]');
    if (button) optionAction(() => state.ranges.splice(Number(button.dataset.deleteRange), 1));
  });
  $('monthly-details').addEventListener('toggle', renderMonthEditors);
  $('month-editors').addEventListener('change', editMonth);
  $('month-editors').addEventListener('input', editMonth);
  $('month-editors').addEventListener('click', event => { if (event.target.dataset.monthAction === 'reset') editMonth(event); });
  const refundChanged = () => {
    if (state.unit) state.refundInputs[state.unit] = $('refunded').value;
    try {
      if (!state.unit) throw new Error('호수를 먼저 선택해 주세요.');
      state.refunds[state.unit] = refundFor(state.unit); setMessage('refund-error');
    } catch(error) { setMessage('refund-error',error.message); }
    dirty();
  };
  $('refunded').addEventListener('input',refundChanged);
  $('refunded').addEventListener('change',refundChanged);
  $('calculator').addEventListener('submit', event => { event.preventDefault(); calculateAndRender(); });
  $('missing-notice').addEventListener('click', event => {
    const button = event.target.closest('[data-fill-start]');
    if (!button) return;
    for (const month of listMonths(button.dataset.fillStart, button.dataset.fillEnd)) state.batch[month] = defaults.amount;
    dirty(); renderMonthEditors(); calculateAndRender(false);
  });

}

function editMonth(event) {
  const action = event.target.dataset.monthAction;
  if (!action) return;
  if (event.type === 'input' && !['reserve','actual','fromDay','toDay'].includes(action)) return;
  const container = event.target.closest('[data-month]'), month = container.dataset.month;
  const household = activeHousehold(), row = { ...(household[month] || {}) };
  const errorNode = container.querySelector('.month-error');
  try {
    if (action === 'reserve') {
      if (event.target.value.trim()) state.monthly[month] = parseMoney(event.target.value);
      else delete state.monthly[month];
    } else {
      if (!state.unit) throw new Error('우리 집 납부액을 조정하려면 호수를 먼저 선택해 주세요.');
      if (action === 'mode') { row.mode = event.target.value; if (row.mode !== 'estimate') delete row.partial; if (row.mode !== 'actual') delete row.amount; for (const key of ['actual','fromDay','toDay']) clearDraft(month,key); }
      if (action === 'actual') row.amount = parseMoney(event.target.value, '우리 집 실제 납부액');
      if (action === 'partial') { if (event.target.checked) row.partial = { fromDay:1, toDay:daysInMonth(month) }; else { delete row.partial; clearDraft(month,'fromDay'); clearDraft(month,'toDay'); } }
      if (action === 'fromDay' || action === 'toDay') {
        const value = Number(event.target.value);
        if (!Number.isInteger(value) || value < 1 || value > daysInMonth(month)) throw new Error('이 달에 있는 날짜를 입력해 주세요.');
        row.partial = { ...row.partial, [action]:value };
      }
      if (action === 'reset') { delete household[month]; delete state.monthly[month]; delete householdDrafts()[month]; delete state.drafts.reserve[month]; }
      else household[month] = row;
    }
    clearDraft(month, action); event.target.removeAttribute('aria-invalid'); dirty();
    if (['mode','partial','reset'].includes(action)) renderMonthEditors();
    else {
      const remaining = Object.values(draftsFor(month)).map(draft => draft.message).join(' ');
      errorNode.textContent = remaining; errorNode.hidden = !remaining;
      const reserve = reserveFor(month);
      container.querySelector('.month-value').textContent = reserve.amount === null ? '금액 미입력' : `전체 ${won(reserve.amount)}원`;
      container.querySelector('.reserve-source').textContent = `${reserve.source} · 비우면 기존 설정 적용`;
    }
  } catch(error) { saveDraft(month,action,event.target.value,error.message); errorNode.textContent = error.message; errorNode.hidden = false; event.target.setAttribute('aria-invalid', 'true'); dirty(); }
}

function calculateAndRender(scroll = true) {
  currentResult = null; $('result').hidden = true;
  for (const id of ['unit-error','form-error']) setMessage(id);
  try {
    if (!building.units.includes(state.unit)) { setMessage('unit-error', '우리 집 호수를 선택해 주세요.'); $('unit').focus(); return; }
    if (!state.start || !state.end) { setMessage('period-error', '시작월과 마지막 납부월을 모두 입력해 주세요.'); (!state.start ? $('start-month') : $('end-month')).focus(); return; }
    const invalidMonth = listMonths(state.start,state.end).find(month => Object.keys(draftsFor(month)).length);
    if (invalidMonth) { $('amount-options').open = true; $('monthly-details').open = true; renderMonthEditors(); const item = $('month-editors').querySelector(`[data-month="${invalidMonth}"]`); if (item) item.open = true; throw new Error(`${formatMonth(invalidMonth)}에 입력한 금액·날짜를 확인해 주세요.`); }
    state.refundInputs[state.unit] = $('refunded').value;
    const refunded = refundFor(state.unit);
    state.refunds[state.unit] = refunded;
    const area = selectedArea();
    const result = calculate({ start:state.start, end:state.end, area, totalArea:building.totalSupply, defaults, batch:state.batch, ranges:state.ranges, monthly:state.monthly, household:selectedHousehold(state.unit,state.start,state.end), refunded });
    if (result.missingAreaMonths.length) throw new Error('호수별 면적 자료를 확인해 주세요.');
    currentResult = result; renderResult();
    if (scroll) { $('result').focus({ preventScroll:true }); $('result').scrollIntoView({ behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block:'start' }); }
  } catch(error) { setMessage('form-error', error.message); }
}

function renderResult() {
  const result = currentResult;
  $('result').hidden = false;
  $('result-unit').textContent = `${state.unit}호 · ${(result.area / 100).toFixed(2)}㎡`;
  const included = result.rows.filter(row => !row.isFuture && row.amount !== null);
  const actualRows = included.filter(row => row.mode === 'actual').length;
  const estimatedRows = included.filter(row => row.mode === 'estimate').length;
  const ownerRows = included.filter(row => row.mode === 'owner').length;
  document.querySelector('.result-badge').textContent = actualRows ? (estimatedRows ? '입력액 포함 추정' : '직접 입력액 기준') : estimatedRows ? '면적 비례 추정' : ownerRows ? '소유자 납부 제외' : '납부액 미계산';
  $('result-title').textContent = result.refunded ? '이미 돌려받은 금액을 뺀 정산액' : '현재까지 납부한 장기수선비';
  if (result.missingMonths.length) $('result-title').textContent += ' · 부분 합계';
  $('claim-value').textContent = won(result.claim);
  $('result-period').textContent = `${formatMonth(result.start)}~${formatMonth(result.end)} · ${result.count}개월`;
  $('result-method').textContent = estimatedRows ? '관리비에 포함해 납부한 것으로 계산했습니다.' : actualRows ? '직접 입력한 세대별 장기수선비를 합산했습니다.' : ownerRows ? '소유자가 직접 납부한 달은 임차인의 정산액에서 제외했습니다.' : '향후 예상액과 금액이 비어 있는 달을 확인해 주세요.';
  $('monthly-preview').textContent = `${result.count}개월 · 월별 금액과 조정 내역 확인`;
  $('monthly-formula-title').textContent = estimatedRows ? '우리 집 면적 비율' : '우리 집 면적 비율 (참고)';
  $('monthly-formula').textContent = `${formatArea(result.area)}㎡ ÷ ${formatArea(result.totalArea)}㎡ ≈ ${formatFraction(result.area,result.totalArea,8)} (약 ${formatPercentage(result.area,result.totalArea)})`;
  const breakdown = [];
  if (result.refunded) breakdown.push(['반환 전 계산액', `${won(result.pastTotal)}원`], ['이미 돌려받은 금액', `−${won(result.refunded)}원`]);
  if (result.actualTotal || result.rows.some(row => row.mode === 'actual')) breakdown.push(['직접 입력액 (과거·현재 월)', `${won(result.actualTotal)}원`], ['면적 추정액 (과거·현재 월)', `${won(result.estimatedTotal)}원`]);
  if (result.futureCount) breakdown.push([`향후 ${result.futureCount}개월 예상액 · 위 금액에 미포함`, `${won(result.futureTotal)}원`]);
  $('result-breakdown').innerHTML = breakdown.length ? `<div class="breakdown">${breakdown.map(([label, value]) => `<p><span>${e(label)}</span><strong>${e(value)}</strong></p>`).join('')}</div>` : '';
  $('missing-notice').innerHTML = result.missingRanges.map(range => `<div class="notice"><strong>${e(range.start)}~${e(range.end)} 금액이 비어 있어요.</strong><br>이 기간은 합계에서 제외했어요. 금액 변경 옵션에서 입력하거나 기본 금액을 적용하세요.<button type="button" class="secondary-button" data-fill-start="${range.start}" data-fill-end="${range.end}">이 구간에도 월 ${won(defaults.amount)}원 적용</button></div>`).join('');
  $('result-rows').innerHTML = result.rows.map(row => `<tr><td>${row.month}${row.isFuture ? '<br><small>향후 예상</small>' : ''}</td><td>${row.reserve === null ? '미입력' : won(row.reserve)}</td><td>${row.amount === null ? '제외' : won(row.amount)}</td><td>${e(row.source)}<br><small>${e(row.reserveSource)}${row.difference !== null && row.difference !== 0 ? `<br>면적 추정 ${won(row.referenceEstimate)}원과 ${row.difference > 0 ? '+' : '−'}${won(Math.abs(row.difference))}원 차이` : ''}</small></td></tr>`).join('');
}

function renderLegal() {
  $('legal-entries').innerHTML = legal.entries.map(entry => `<div class="legal-entry"><p class="legal-condition">${e(entry.condition)}</p><blockquote>${e(entry.quote)}</blockquote><a href="${e(entry.url)}" target="_blank" rel="noopener noreferrer">${e(entry.title)} ↗</a></div>`).join('');
  $('source-content').innerHTML = `
    <section class="source-block"><h3>계산은 이렇게 해요</h3><div class="formula-steps"><span>전체 월 적립액</span><b aria-hidden="true">×</b><span>우리 집 면적</span><b aria-hidden="true">÷</b><span>전체 면적</span></div><p>전체 공급면적 <strong>${formatArea(building.totalSupply)}㎡</strong> · 선택 기간의 월별 금액 합산</p></section>
    <section class="source-block"><h3>기본 금액과 납부 가정</h3><dl class="source-facts"><div><dt>기본 기간</dt><dd>${e(formatMonth(defaults.from))}~${e(formatMonth(defaults.to))}</dd></div><div><dt>전체 월 적립액</dt><dd>${won(defaults.amount)}원</dd></div><div><dt>납부 방식</dt><dd>관리비에 포함해 면적 비율만큼 납부한 것으로 가정</dd></div></dl></section>
    <section class="source-block"><h3>호수별 면적</h3><p>공급면적 기준 · A/B는 면적 타입</p><div class="table-wrap" tabindex="0" role="region" aria-label="호수별 공급면적과 전용면적 표"><table><caption class="sr-only">호수별 면적, 단위 제곱미터</caption><thead><tr><th scope="col">호수</th><th scope="col">공급면적 ㎡</th><th scope="col">전용면적 ㎡</th></tr></thead><tbody>${building.units.map(unit => { const type = unitType(unit); return `<tr><th scope="row">${unit}호</th><td>${(type.supply/100).toFixed(2)}${type.variant ? ` <small class="type-tag">${e(type.variant)}</small>` : ''}</td><td>${(type.exclusive/100).toFixed(2)}</td></tr>`; }).join('')}</tbody></table></div></section>
    <section class="source-block"><h3>자료 출처</h3><p>호수별 면적은 제공 자료, 면적 타입은 아래 출처를 참고했습니다.</p><div class="source-links">${building.sources.map(source => `<a href="${e(source.url)}" target="_blank" rel="noopener noreferrer"><span>${e(source.title)}</span><span class="source-link-action">새 창 <span aria-hidden="true">↗</span></span></a>`).join('')}</div><p class="help">공개 자료 확인일: ${e(building.checkedAt)}</p></section>
`;
}

function registerAgentTool() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  const tool = { name:'calculate_awon_refund', title:'아원데코빌 장기수선비 계산', description:'호수와 납부 기간을 입력해 화면에 추정 정산액을 표시합니다. 면적은 호수별 자료에서 자동 적용합니다. 기본은 2024~2026년 월 280000원이며 현재 월 이후는 향후 예상액으로 구분합니다.', inputSchema:{ type:'object', properties:{ unit:{type:'string',enum:building.units}, start:{type:'string'}, end:{type:'string'} }, required:['unit','start','end'], additionalProperties:false }, annotations:{readOnlyHint:false}, execute(input) {
    if (!input || !building.units.includes(input.unit) || Object.keys(input).some(key => !['unit','start','end'].includes(key))) throw new Error('호수·시작월·종료월을 올바르게 입력해 주세요.');
    const months = listMonths(input.start,input.end);
    const area = selectedArea(input.unit);
    if (months.some(month => state.drafts.reserve[month] || Object.keys(state.drafts.households[input.unit]?.[month] || {}).length)) throw new Error('화면에서 월별 입력 오류를 먼저 수정해 주세요.');
    calculate({ start:input.start,end:input.end,area,totalArea:building.totalSupply,defaults,batch:state.batch,ranges:state.ranges,monthly:state.monthly,household:selectedHousehold(input.unit,input.start,input.end),refunded:refundFor(input.unit) });
    state.unit = input.unit; state.start = input.start; state.end = input.end;
    dirty(); syncForm(); calculateAndRender(false);
    if (!currentResult) throw new Error($('form-error').textContent || '입력값을 확인해 주세요.');
    return {claim:currentResult.claim, future:currentResult.futureTotal, missingMonths:currentResult.missingMonths, count:currentResult.count};
  }};
  try { Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(() => {}); } catch { /* Optional browser capability. */ }
  addEventListener('pagehide', () => lifecycle.abort(), {once:true});
}

init().catch(error => { setMessage('load-error', error.message || '기본 자료를 불러오지 못했어요. 새로고침해 주세요.'); });
