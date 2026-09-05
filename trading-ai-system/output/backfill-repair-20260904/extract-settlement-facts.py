"""Read original settlement exports. Never edit source workbooks or assume column positions."""
import hashlib
import json
import math
import re
from datetime import date
from pathlib import Path

import openpyxl


def text(value):
    return re.sub(r'\s+', '', str(value or ''))


def number(value):
    if value is None or isinstance(value, bool) or value == '':
        return None
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (ValueError, TypeError):
        return None


def extract_sheet(rows, merged_ranges=()):
    title = text(rows[0][0])
    match = re.search(r'(20\d{2})年(\d{1,2})月(\d{1,2})日现货日清分核对单', title)
    if not match:
        return None
    business_date = date(*map(int, match.groups())).isoformat()
    if not any('单位：兆瓦时、元、元/兆瓦时' in text(v) for row in rows[:5] for v in row):
        raise ValueError(f'Unknown units: {business_date}')
    header_index = next((i for i, row in enumerate(rows[:8]) if text(row[0]) == '时段' and len(row) > 1 and text(row[1]) == '用电量'), None)
    if header_index is None:
        return None
    parent, child = rows[header_index], rows[header_index + 1]
    definitions = [
        ('日前偏差结算', '电价', 'dayAheadUserPriceFinalYuanPerMwh', '元/MWh'),
        ('实时偏差结算', '电价', 'realTimeSettlementPriceYuanPerMwh', '元/MWh'),
        ('中长期合约结算', '电量', 'settledLongTermEnergyMwh', 'MWh'),
        ('中长期合约结算', '电费', 'settledLongTermFeeYuan', '元'),
        ('能量块交易结算', '电量', 'settledEnergyBlockMwh', 'MWh'),
        ('能量块交易结算', '电费', 'settledEnergyBlockFeeYuan', '元'),
        ('结算情况', '交易电费', 'settlementAmountYuan', '元'),
        ('结算情况', '交易单价', 'settlementPriceYuanPerMwh', '元/MWh'),
    ]
    columns = []
    for group, heading, field, unit in definitions:
        starts = [i for i, v in enumerate(parent) if text(v) == group]
        if not starts:
            continue
        assert len(starts) == 1
        start = starts[0]
        group_merge = next((m for m in merged_ranges if m.min_row == header_index + 1 and m.min_col == start + 1), None)
        end = group_merge.max_col if group_merge else next((i for i in range(start + 1, len(parent)) if text(parent[i])), len(parent))
        candidates = [i for i in range(start, min(end, len(child))) if text(child[i]) == heading or (heading == '电价' and text(child[i]).startswith('电价（'))]
        if len(candidates) != 1:
            raise ValueError(f'Ambiguous header: {business_date} {group} {heading}')
        column = {'index': candidates[0], 'fieldId': field, 'unit': unit, 'header': f'{group}/{text(child[candidates[0]])}'}
        if heading == '电价':
            for label, key in [('电量', 'quantityIndex'), ('电费', 'feeIndex')]:
                indices = [i for i in range(start, min(end, len(child))) if text(child[i]) == label]
                if len(indices) != 1:
                    raise ValueError(f'Missing reconciliation column: {business_date} {group}')
                column[key] = indices[0]
        columns.append(column)
    points = []
    for row_index, row in enumerate(rows):
        match = re.fullmatch(r'(\d{1,2}):(\d{2})', text(row[0]))
        if not match:
            continue
        hour, minute = map(int, match.groups())
        minutes = hour * 60 + minute
        point = 96 if minutes == 0 else minutes // 15
        if minutes % 15 or not 1 <= point <= 96:
            raise ValueError(f'Invalid interval: {business_date}')
        points.append((point, row_index + 1, row))
    if [p[0] for p in points] != list(range(1, 97)):
        raise ValueError(f'Incomplete or duplicate day: {business_date}')
    values = []
    coverage = {}
    for col in columns:
        count = 0
        for point, source_row, row in points:
            value = number(row[col['index']] if col['index'] < len(row) else None)
            if value is None:
                continue
            if 'quantityIndex' in col:
                quantity, fee = number(row[col['quantityIndex']]), number(row[col['feeIndex']])
                if quantity is None or fee is None or abs(value * quantity - fee) > 0.011:
                    raise ValueError(f'Price/energy/fee reconciliation failed: {business_date} {col["fieldId"]} point {point}')
            values.append({'fieldId': col['fieldId'], 'pointIndex': point, 'value': value, 'unit': col['unit'], 'sourceCell': f'{openpyxl.utils.get_column_letter(col["index"] + 1)}{source_row}'})
            count += 1
        coverage[col['fieldId']] = count
    return {'businessDate': business_date, 'title': title, 'columns': columns, 'coverage': coverage, 'values': values}


def main():
    days, errors = [], []
    for source in Path('E:/electric').glob('*现货核对单*.xlsx'):
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        workbook = openpyxl.load_workbook(source, data_only=True, read_only=False)
        try:
            for sheet in workbook:
                if not (sheet.title.isdigit() or sheet.title == '合约日清分'):
                    continue
                try:
                    day = extract_sheet(list(sheet.values), sheet.merged_cells.ranges)
                    if day and day['values']:
                        month = re.search(r'(20\d{2})年(\d{1,2})月', source.name)
                        if month and sheet.title.isdigit():
                            expected = date(int(month[1]), int(month[2]), int(sheet.title)).isoformat()
                            if day['businessDate'] != expected:
                                raise ValueError(f'Workbook/title date conflict: {expected} versus {day["businessDate"]}')
                        days.append({**day, 'sourceFile': str(source), 'sourceSheet': sheet.title, 'sourceSha256': digest})
                except (ValueError, AssertionError) as error:
                    errors.append({'file': source.name, 'sheet': sheet.title, 'error': str(error)})
        finally:
            workbook.close()
    print(json.dumps({'days': days, 'errors': errors}, ensure_ascii=False))


if __name__ == '__main__':
    main()
