#!/usr/bin/env python3
"""Independent exact arithmetic oracle for the apartment reserve calculator.

Only the Python standard library is used. Expected answers are calculated with
fractions.Fraction and calendar.monthrange; application code is never called or
loaded. All monetary rounding is nearest won, with exact halves rounded upward.
The chosen period includes both endpoint months. Current-month payments belong
to the paid subtotal. Actual payments replace estimates; owner payments are 0.

Usage: python3 oracle.py --output /tmp/awon-oracle.json
"""
from __future__ import annotations
import argparse
import calendar
import copy
import json
import random
from collections import Counter
from fractions import Fraction
from pathlib import Path

SEED = 20260917
MAX_MONEY = 10**12
MAX_SAFE_INTEGER = 2**53 - 1
TOTAL = 176307
AREAS = [3622, 7081, 8292, 11427, 11704, 14437] + [14968] * 8
UNITS = {'101': 14968, '102': 14968, '201': 14968, '202': 14968,
         '301': 14968, '302': 14968, '401': 14968, '402': 14968,
         '501': 11704, '502': 14437, '601': 7081, '602': 11427,
         '701': 3622, '702': 8292}
DEFAULTS = {'from': '2024-01', 'to': '2026-12', 'amount': 280000}


def round_won(value: Fraction) -> int:
    """Decimal half-up for nonnegative values; no float conversion."""
    whole, remainder = divmod(value.numerator, value.denominator)
    return whole + (2 * remainder >= value.denominator)


def percentage(area: int, total: int, places: int) -> str:
    scaled = round_won(Fraction(area * 100 * 10**places, total))
    return f'{scaled // 10**places}.{scaled % 10**places:0{places}d}'


def month_add(value: str, count: int) -> str:
    year, month = map(int, value.split('-'))
    while count > 0:
        month += 1
        if month == 13:
            year, month = year + 1, 1
        count -= 1
    while count < 0:
        month -= 1
        if month == 0:
            year, month = year - 1, 12
        count += 1
    return f'{year:04d}-{month:02d}'


def months_between(start: str, end: str) -> list[str]:
    answer = []
    while start <= end:
        answer.append(start)
        start = month_add(start, 1)
    return answer


def missing_groups(months: list[str]) -> list[dict]:
    answer = []
    for month in months:
        if answer and month_add(answer[-1]['end'], 1) == month:
            answer[-1]['end'] = month
        else:
            answer.append({'start': month, 'end': month})
    return answer


def oracle(data: dict) -> dict:
    """Valid-input reference specification, independent of the JS calculator."""
    months = months_between(data['start'], data['end'])
    area, total, as_of = data.get('area'), data['totalArea'], data['asOfMonth']
    paid, future, actual, estimated = [], [], [], []
    missing, missing_reserve, missing_area = [], [], []
    rows = []
    for month in months:
        reserve, reserve_source = None, '금액 미입력'
        preset = data.get('defaults')
        if preset and preset['from'] <= month <= preset['to']:
            reserve, reserve_source = preset['amount'], '기본 가정'
        if month in data.get('batch', {}):
            reserve, reserve_source = data['batch'][month], '일괄 입력'
        for change in data.get('ranges', []):
            if change['start'] <= month <= change['end']:
                reserve, reserve_source = change['amount'], '기간별 수정'
                break
        if month in data.get('monthly', {}):
            reserve, reserve_source = data['monthly'][month], '월별 수정'
        adjustment = data.get('household', {}).get(month, {})
        mode = adjustment.get('mode') or 'estimate'
        days = calendar.monthrange(*map(int, month.split('-')))[1]
        used_days = days
        source, amount = '면적 비례', None
        if mode == 'owner':
            amount, source = Fraction(0), '소유자 납부 · 제외'
        elif mode == 'actual':
            amount, source = Fraction(adjustment['amount']), '세대 직접 입력'
        elif mode == 'estimate':
            partial = adjustment.get('partial')
            if partial:
                used_days = partial['toDay'] - partial['fromDay'] + 1
                source = f'일할 추정 ({used_days}/{days}일)'
            if reserve is None:
                missing_reserve.append(month)
            if area is None:
                missing_area.append(month)
            if reserve is not None and area is not None:
                # Area allocation then time allocation, retaining both exact ratios.
                amount = Fraction(reserve) * Fraction(area, total) * Fraction(used_days, days)
        else:
            raise ValueError('unsupported mode in valid fixture')
        future_month = month > as_of
        if amount is None:
            missing.append(month)
        elif future_month:
            future.append(amount)
        else:
            paid.append(amount)
            if mode == 'actual':
                actual.append(amount)
            elif mode == 'estimate':
                estimated.append(amount)
        reference = None
        if mode == 'actual' and area is not None and reserve is not None:
            reference = round_won(Fraction(reserve) * Fraction(area, total))
        rounded = None if amount is None else round_won(amount)
        rows.append({'month': month, 'reserve': reserve, 'reserveSource': reserve_source,
                     'amount': rounded, 'source': source, 'mode': mode,
                     'isFuture': future_month, 'usedDays': used_days, 'days': days,
                     'referenceEstimate': reference,
                     'difference': None if reference is None else rounded - reference})
    paid_sum = sum(paid, Fraction(0))
    future_sum = sum(future, Fraction(0))
    past_total = round_won(paid_sum)
    refund = data.get('refunded', 0)
    assert 0 <= refund <= past_total
    return {'start': data['start'], 'end': data['end'], 'asOfMonth': as_of,
            'area': area, 'totalArea': total, 'rows': rows, 'count': len(months),
            'pastTotal': past_total, 'futureTotal': round_won(future_sum),
            'total': round_won(paid_sum + future_sum),
            'actualTotal': round_won(sum(actual, Fraction(0))),
            'estimatedTotal': round_won(sum(estimated, Fraction(0))),
            'refunded': refund, 'claim': past_total - refund,
            'futureCount': sum(row['isFuture'] for row in rows),
            'missingMonths': missing, 'missingReserveMonths': missing_reserve,
            'missingAreaMonths': missing_area, 'missingRanges': missing_groups(missing_reserve)}


def base(**changes) -> dict:
    result = {'start': '2024-01', 'end': '2025-12', 'asOfMonth': '2026-09',
              'area': 7081, 'totalArea': TOTAL, 'defaults': copy.deepcopy(DEFAULTS)}
    result.update(changes)
    return result


def generate(random_count: int, seed: int) -> dict:
    rng = random.Random(seed)
    cases, invalid = [], []

    def add(name, data, tags):
        cases.append({'name': name, 'tags': tags, 'input': data, 'expected': oracle(data)})

    for unit, area in UNITS.items():
        add(f'unit-{unit}-24-months', base(area=area), ['building', '24-months'])
        add(f'unit-{unit}-36-months', base(area=area, end='2026-12', asOfMonth='2026-12'),
            ['building', '36-months'])
    for year in [1900, 2000, 2024, 2025, 2100, 2200]:
        month = f'{year}-02'
        days = calendar.monthrange(year, 2)[1]
        for first, last in [(1, 1), (days, days), (1, days), (days // 2, days)]:
            add(f'february-{year}-{first}-{last}',
                base(start=month, end=month, asOfMonth=month, defaults=None,
                     monthly={month: 280000}, household={month: {'partial': {'fromDay': first, 'toDay': last}}}),
                ['calendar', 'partial', 'century-leap-year'])
    for reserve in [0, 1, 2, 3, 280000, MAX_MONEY - 1, MAX_MONEY]:
        for area, total in [(1, 2), (1, 3), (2, 3), (1, MAX_SAFE_INTEGER),
                            (MAX_SAFE_INTEGER - 1, MAX_SAFE_INTEGER),
                            (MAX_SAFE_INTEGER, MAX_SAFE_INTEGER)]:
            add(f'rounding-{reserve}-{area}-{total}',
                base(start='2024-01', end='2024-03', asOfMonth='2024-02',
                     area=area, totalArea=total, defaults=None,
                     batch={f'2024-{month:02d}': reserve for month in [1, 2, 3]}),
                ['rounding', 'safe-integer-area', 'split-paid-future', 'boundary-money'])
    for start, current in [('1900-01', '1900-01'), ('1950-01', '1975-01'),
                           ('2151-01', '2200-12')]:
        end = month_add(start, 599)
        add(f'maximum-duration-{start}', base(start=start, end=end, asOfMonth=current,
            area=TOTAL, defaults={'from': start, 'to': end, 'amount': MAX_MONEY}),
            ['600-months', 'boundary-money', 'full-area'])
    add('exact-maximum-600-actual-payments', base(start='1900-01', end='1949-12',
        asOfMonth='2200-12', area=None, defaults=None,
        household={m: {'mode': 'actual', 'amount': MAX_MONEY} for m in months_between('1900-01', '1949-12')}),
        ['600-months', 'actual', 'missing-area', 'missing-reserve', 'boundary-money'])
    add('all-priority-levels-with-zero', base(start='2024-01', end='2024-05',
        batch={'2024-01': 1, '2024-02': 2, '2024-03': 3, '2024-04': 4},
        ranges=[{'start': '2024-02', 'end': '2024-03', 'amount': 7},
                {'start': '2024-04', 'end': '2024-04', 'amount': 0}], monthly={'2024-03': 0}),
        ['priority', 'zero', 'adjacent-ranges'])
    for missing_area in [True, False]:
        for missing_reserve in [True, False]:
            add(f'missing-inputs-{missing_area}-{missing_reserve}',
                base(start='2024-01', end='2024-04', asOfMonth='2024-03',
                     area=None if missing_area else 7081, defaults=None if missing_reserve else DEFAULTS,
                     household={'2024-01': {'mode': 'actual', 'amount': 0},
                                '2024-02': {'mode': 'owner'},
                                '2024-03': {'mode': 'actual', 'amount': 999}}),
                ['missing-area', 'missing-reserve', 'actual', 'owner', 'zero', 'split-paid-future'])
    add('actual-and-owner-ignore-partial', base(start='2024-02', end='2024-03',
        household={'2024-02': {'mode': 'actual', 'amount': 10000, 'partial': {'fromDay': 14, 'toDay': 29}},
                   '2024-03': {'mode': 'owner', 'partial': {'fromDay': 1, 'toDay': 7}}}),
        ['actual', 'owner', 'partial'])
    add('missing-group-across-year', base(start='2023-11', end='2024-03', defaults=None,
        monthly={'2024-02': 0}), ['missing-reserve', 'missing-groups', 'zero'])
    amounts = [0, 1, 2, 3, 10, 999, 280000, 300000, 999999999999, MAX_MONEY]

    def amount():
        return rng.choice(amounts) if rng.random() < .65 else rng.randrange(MAX_MONEY + 1)

    for index in range(random_count):
        count = rng.choice([1, 2, 12, 24, 36, 60, 120, 599, 600]) if index % 30 == 0 else rng.randrange(1, 49)
        year = rng.randrange(1900, 2151) if index % 4 == 0 else rng.randrange(2020, 2029)
        start = f'{year:04d}-{rng.randrange(1, 13):02d}'
        months = [month_add(start, i) for i in range(count)]
        offset = rng.choice([-1, 0, count // 2, count - 1, count])
        as_of = month_add(start, offset)
        if as_of < '1900-01':
            as_of = '1900-01'
        area_total = rng.choice([(rng.choice(AREAS), TOTAL), (1, 2), (1, 3),
                                 (rng.randrange(1, MAX_SAFE_INTEGER + 1), MAX_SAFE_INTEGER),
                                 (TOTAL, TOTAL), (None, TOTAL)])
        area, total = area_total
        preset = rng.choice([copy.deepcopy(DEFAULTS), None,
                            {'from': months[0], 'to': months[-1], 'amount': amount()},
                            {'from': months[count // 3], 'to': months[count * 2 // 3], 'amount': amount()}])
        batch = {m: amount() for m in months if rng.random() < .18}
        monthly = {m: amount() for m in months if rng.random() < .18}
        ranges = []
        cursor = 0
        while cursor < count:
            if rng.random() < .15:
                end_index = min(count - 1, cursor + rng.randrange(0, min(count, 7)))
                ranges.append({'start': months[cursor], 'end': months[end_index], 'amount': amount()})
                cursor = end_index + 1
            else:
                cursor += 1
        rng.shuffle(ranges)
        adjustments = {}
        for month in months:
            selection = rng.random()
            if selection < .20:
                adjustments[month] = {'mode': 'actual', 'amount': amount()}
            elif selection < .32:
                adjustments[month] = {'mode': 'owner'}
            elif selection < .63:
                days = calendar.monthrange(*map(int, month.split('-')))[1]
                first = rng.randrange(1, days + 1)
                adjustments[month] = {'mode': 'estimate', 'partial': {'fromDay': first, 'toDay': rng.randrange(first, days + 1)}}
        data = base(start=start, end=months[-1], asOfMonth=as_of, area=area, totalArea=total,
                    defaults=preset, batch=batch, ranges=ranges, monthly=monthly, household=adjustments)
        result = oracle(data)
        max_refund = min(MAX_MONEY, result['pastTotal'])
        data['refunded'] = rng.choice([0, max_refund, rng.randrange(max_refund + 1)])
        add(f'random-{index:04d}', data, ['randomized'])

    invalid_inputs = {
        'reversed-period': {'start': '2025-02', 'end': '2025-01'},
        '601-months': {'start': '1900-01', 'end': '1950-01'},
        'start-month-zero': {'start': '2024-00'},
        'start-month-thirteen': {'start': '2024-13'},
        'start-unpadded': {'start': '2024-1'},
        'start-not-string': {'start': 202401},
        'year-too-low': {'start': '1899-12'},
        'year-too-high': {'end': '2201-01'},
        'bad-asof': {'asOfMonth': '2026-00'},
        'area-zero': {'area': 0}, 'area-negative': {'area': -1},
        'area-fraction': {'area': 7081.1}, 'area-excess': {'area': TOTAL + 1},
        'area-unsafe': {'area': MAX_SAFE_INTEGER + 1, 'totalArea': MAX_SAFE_INTEGER},
        'total-zero': {'totalArea': 0}, 'total-negative': {'totalArea': -1},
        'total-fraction': {'totalArea': TOTAL + .5},
        'total-unsafe': {'totalArea': MAX_SAFE_INTEGER + 1},
        'refund-negative': {'refunded': -1}, 'refund-fraction': {'refunded': .5},
        'refund-over-limit': {'refunded': MAX_MONEY + 1},
        'refund-more-than-paid': {'refunded': 10**9},
        'refund-future-only': {'start': '2026-10', 'end': '2026-12', 'refunded': 1},
        'overlap-ranges': {'ranges': [{'start': '2024-01', 'end': '2024-03', 'amount': 1}, {'start': '2024-03', 'end': '2024-04', 'amount': 2}]},
        'nested-ranges': {'ranges': [{'start': '2024-01', 'end': '2024-12', 'amount': 1}, {'start': '2024-02', 'end': '2024-03', 'amount': 2}]},
        'reversed-range': {'ranges': [{'start': '2024-03', 'end': '2024-02', 'amount': 1}]},
        'range-too-long': {'ranges': [{'start': '1900-01', 'end': '1950-01', 'amount': 1}]},
        'invalid-mode': {'household': {'2024-01': {'mode': 'tenant'}}},
        'actual-missing-amount': {'household': {'2024-01': {'mode': 'actual'}}},
    }
    for mode in ['monthly', 'batch', 'defaults', 'ranges', 'actual']:
        for label, value in [('negative', -1), ('fraction', 1.5), ('string', '1000'), ('null', None), ('over-limit', MAX_MONEY + 1)]:
            if mode in ['monthly', 'batch']:
                change = {mode: {'2024-01': value}}
            elif mode == 'defaults':
                change = {'defaults': {**DEFAULTS, 'amount': value}}
            elif mode == 'ranges':
                change = {'ranges': [{'start': '2024-01', 'end': '2024-01', 'amount': value}]}
            else:
                change = {'household': {'2024-01': {'mode': 'actual', 'amount': value}}}
            invalid_inputs[f'{mode}-{label}'] = change
    for label, partial in [('day-zero', {'fromDay': 0, 'toDay': 2}),
                            ('day-thirty-two', {'fromDay': 1, 'toDay': 32}),
                            ('reversed-days', {'fromDay': 5, 'toDay': 4}),
                            ('fraction-day', {'fromDay': 1.5, 'toDay': 2}),
                            ('missing-day', {'fromDay': 1}),
                            ('string-day', {'fromDay': '1', 'toDay': 2})]:
        invalid_inputs[label] = {'household': {'2024-01': {'partial': partial}}}
    invalid_inputs['non-leap-february-29'] = {'start': '2025-02', 'end': '2025-02', 'household': {'2025-02': {'partial': {'fromDay': 1, 'toDay': 29}}}}
    invalid_inputs['century-non-leap-february-29'] = {'start': '2100-02', 'end': '2100-02', 'monthly': {'2100-02': 1000}, 'household': {'2100-02': {'partial': {'fromDay': 1, 'toDay': 29}}}}
    for name, change in invalid_inputs.items():
        invalid.append({'name': name, 'input': base(**change)})

    coverage = Counter()
    discrepancies = []
    for case in cases:
        data, result = case['input'], case['expected']
        coverage.update(case['tags'])
        coverage['rows'] += result['count']
        coverage['future-rows'] += result['futureCount']
        coverage['missing-rows'] += len(result['missingMonths'])
        coverage['refund-nonzero-cases'] += result['refunded'] > 0
        for row in result['rows']:
            coverage[f'mode-{row["mode"]}-rows'] += 1
            coverage[f'reserve-source-{row["reserveSource"]}'] += 1
            coverage['partial-rows'] += row['usedDays'] != row['days']
        gap = result['pastTotal'] + result['futureTotal'] - result['total']
        if gap:
            coverage['subtotal-rounding-difference-cases'] += 1
            if len(discrepancies) < 5:
                discrepancies.append({'case': case['name'], 'past': result['pastTotal'], 'future': result['futureTotal'], 'total': result['total'], 'gap': gap})
    ratios = [{'unit': unit, 'area': area, 'totalArea': TOTAL,
               'exactFraction': str(Fraction(area, TOTAL)),
               'percent2': percentage(area, TOTAL, 2), 'percent4': percentage(area, TOTAL, 4),
               'monthlyEstimate': round_won(Fraction(280000 * area, TOTAL)),
               'claim24': round_won(Fraction(280000 * area * 24, TOTAL)),
               'claim36': round_won(Fraction(280000 * area * 36, TOTAL))}
              for unit, area in UNITS.items()]
    assert sum(UNITS.values()) == TOTAL
    assert sum(Fraction(280000 * a, TOTAL) for a in UNITS.values()) == 280000
    return {'metadata': {'seed': seed, 'randomCases': random_count, 'validCases': len(cases),
                         'invalidCases': len(invalid), 'coverage': dict(coverage),
                         'roundingSubtotalExamples': discrepancies,
                         'buildingExactAllocationConservesMonthlyReserve': True,
                         'ratioChecks': ratios}, 'valid': cases, 'invalid': invalid}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('/tmp/awon-math-oracle/cases.json'))
    parser.add_argument('--count', type=int, default=1536)
    parser.add_argument('--seed', type=int, default=SEED)
    args = parser.parse_args()
    dataset = generate(args.count, args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dataset, ensure_ascii=False, separators=(',', ':')) + '\n')
    summary = args.output.with_suffix('.summary.json')
    summary.write_text(json.dumps(dataset['metadata'], ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'output': str(args.output), 'summary': str(summary),
                      'validCases': dataset['metadata']['validCases'],
                      'invalidCases': dataset['metadata']['invalidCases'],
                      'rows': dataset['metadata']['coverage']['rows']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
