export const won = value => new Intl.NumberFormat('ko-KR').format(value);
export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// Display-only rounding: calculation.js never consumes these strings.
export function formatFraction(numerator,denominator,places) {
  if (!Number.isSafeInteger(numerator) || numerator < 0 || !Number.isSafeInteger(denominator) || denominator <= 0 || !Number.isInteger(places) || places < 0 || places > 12) throw new Error('비율 표시값을 확인해 주세요.');
  return fixedFraction(BigInt(numerator),BigInt(denominator),places);
}
function fixedFraction(n,d,places) {
  const scale = 10n ** BigInt(places);
  const value = (2n*n*scale+d)/(2n*d);
  return places ? `${value/scale}.${String(value%scale).padStart(places,'0')}` : String(value);
}
export function formatPercentage(area,total,places=4) {
  formatFraction(area,total,places); // Validate before scaling with BigInt.
  return fixedFraction(BigInt(area)*100n,BigInt(total),places)+'%';
}
export function formatArea(hundredths) {
  if (!Number.isSafeInteger(hundredths) || hundredths < 0) throw new Error('면적 표시값을 확인해 주세요.');
  const area = BigInt(hundredths);
  return `${new Intl.NumberFormat('ko-KR').format(area/100n)}.${String(area%100n).padStart(2,'0')}`;
}
