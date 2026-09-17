export const MAX_MONEY = 1_000_000_000_000;
export const MAX_MONTHS = 600;

export function monthIndex(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('연도와 월을 모두 입력해 주세요.');
  const [year, month] = value.split('-').map(Number);
  if (year < 1900 || year > 2200) throw new Error('연도는 1900~2200년 사이로 입력해 주세요.');
  return year * 12 + month - 1;
}
export function monthKey(index) {
  return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`;
}
export function addMonths(month, count) {
  const result = monthKey(monthIndex(month) + count);
  monthIndex(result);
  return result;
}
export function listMonths(start, end) {
  const first = monthIndex(start), last = monthIndex(end);
  if (first > last) throw new Error('마지막 납부월을 시작월과 같거나 이후로 선택해 주세요.');
  if (last - first + 1 > MAX_MONTHS) throw new Error('한 번에 최대 600개월까지 계산할 수 있습니다.');
  return Array.from({ length: last - first + 1 }, (_, i) => monthKey(first + i));
}
export function daysInMonth(month) {
  monthIndex(month);
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
}
export function formatMonth(month) {
  monthIndex(month);
  return `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;
}
export function currentMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).formatToParts(date);
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
}
export function validateMoney(value, label = '금액') {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY) throw new Error(`${label}은 0~1조 원 사이의 정수로 입력해 주세요.`);
  return value;
}
export function parseMoney(value, label = '금액') {
  const text = String(value).trim().replaceAll(',', '');
  if (!/^\d+$/.test(text)) throw new Error(`${label}을 원 단위 숫자로 입력해 주세요.`);
  return validateMoney(Number(text), label);
}
export function parseArea(value) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('면적을 소수점 둘째 자리까지 입력해 주세요.');
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error('면적은 0보다 커야 합니다.');
  return result;
}
export function groupMonths(months) {
  const groups = [];
  for (const month of [...new Set(months)].sort()) {
    const previous = groups.at(-1);
    if (previous && monthIndex(month) === monthIndex(previous.end) + 1) previous.end = month;
    else groups.push({ start: month, end: month });
  }
  return groups;
}
export function validateRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
  sorted.forEach((range, index) => {
    listMonths(range.start, range.end);
    validateMoney(range.amount);
    if (index && sorted[index - 1].end >= range.start) throw new Error('금액 변경 기간이 겹칩니다. 기존 기간을 수정하거나 범위를 나누어 주세요.');
  });
}

// Exact fractions prevent both floating point and monthly rounding errors.
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
const zero = () => ({ n: 0n, d: 1n });
function fraction(n, d = 1n) { const g = gcd(n, d); return { n: n / g, d: d / g }; }
function plus(a, b) { return fraction(a.n * b.d + b.n * a.d, a.d * b.d); }
function rounded(a) { return Number((2n * a.n + a.d) / (2n * a.d)); }

export function reserveForMonth(month, { defaults, batch = {}, ranges = [], monthly = {} }) {
  if (Object.hasOwn(monthly, month)) return { amount: validateMoney(monthly[month]), source: '월별 수정' };
  const range = ranges.find(r => r.start <= month && month <= r.end);
  if (range) return { amount: validateMoney(range.amount), source: '기간별 수정' };
  if (Object.hasOwn(batch, month)) return { amount: validateMoney(batch[month]), source: '일괄 입력' };
  if (defaults && defaults.from <= month && month <= defaults.to) return { amount: validateMoney(defaults.amount), source: '기본 가정' };
  return { amount: null, source: '금액 미입력' };
}

export function calculate({ start, end, asOfMonth = currentMonth(), area = null, totalArea, defaults, batch = {}, ranges = [], monthly = {}, household = {}, refunded = 0 }) {
  const months = listMonths(start, end);
  monthIndex(asOfMonth);
  validateRanges(ranges);
  validateMoney(refunded, '반환받은 금액');
  if (!Number.isSafeInteger(totalArea) || totalArea <= 0) throw new Error('전체 기준 면적을 확인해 주세요.');
  if (area !== null && (!Number.isSafeInteger(area) || area <= 0 || area > totalArea)) throw new Error('세대 면적은 전체 기준 면적 이하의 양수여야 합니다.');
  let past = zero(), future = zero(), actual = zero(), estimated = zero();
  const missingMonths = [], missingReserveMonths = [], missingAreaMonths = [];
  const rows = months.map(month => {
    const reserve = reserveForMonth(month, { defaults, batch, ranges, monthly });
    const adjustment = household[month] || {};
    const mode = adjustment.mode || 'estimate';
    const isFuture = month > asOfMonth;
    const days = daysInMonth(month);
    let value = null, usedDays = days, source = '면적 비례';
    if (mode === 'owner') { value = zero(); source = '소유자 납부 · 제외'; }
    else if (mode === 'actual') { value = fraction(BigInt(validateMoney(adjustment.amount, '세대 직접 입력액'))); source = '세대 직접 입력'; }
    else if (mode === 'estimate') {
      if (adjustment.partial) {
        const { fromDay, toDay } = adjustment.partial;
        if (!Number.isInteger(fromDay) || !Number.isInteger(toDay) || fromDay < 1 || toDay > days || fromDay > toDay) throw new Error(`${formatMonth(month)}의 납부 일수 범위를 확인해 주세요.`);
        usedDays = toDay - fromDay + 1;
        source = `일할 추정 (${usedDays}/${days}일)`;
      }
      if (reserve.amount === null) missingReserveMonths.push(month);
      if (area === null) missingAreaMonths.push(month);
      if (reserve.amount !== null && area !== null) value = fraction(BigInt(reserve.amount) * BigInt(area) * BigInt(usedDays), BigInt(totalArea) * BigInt(days));
    } else throw new Error('월별 납부 방식이 올바르지 않습니다.');
    if (value === null) missingMonths.push(month);
    else if (isFuture) future = plus(future, value);
    else {
      past = plus(past, value);
      if (mode === 'actual') actual = plus(actual, value);
      if (mode === 'estimate') estimated = plus(estimated, value);
    }
    const referenceEstimate = mode === 'actual' && area !== null && reserve.amount !== null ? rounded(fraction(BigInt(reserve.amount) * BigInt(area), BigInt(totalArea))) : null;
    const difference = referenceEstimate === null || value === null ? null : rounded(value) - referenceEstimate;
    return { month, reserve: reserve.amount, reserveSource: reserve.source, amount: value === null ? null : rounded(value), source, mode, isFuture, usedDays, days, referenceEstimate, difference };
  });
  const pastTotal = rounded(past);
  if (refunded > pastTotal) throw new Error('반환받은 금액이 현재까지 계산한 금액보다 큽니다. 기간과 금액을 확인해 주세요.');
  return {
    start, end, asOfMonth, area, totalArea, rows, count: months.length,
    pastTotal, futureTotal: rounded(future), total: rounded(plus(past, future)),
    actualTotal: rounded(actual), estimatedTotal: rounded(estimated), refunded,
    claim: pastTotal - refunded, futureCount: rows.filter(r => r.isFuture).length,
    missingMonths, missingReserveMonths, missingAreaMonths, missingRanges: groupMonths(missingReserveMonths)
  };
}
