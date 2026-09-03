import json
FORBIDDEN = ('actual', 'settlement')
def validate_training_row(row):
    for key in row.get('features', {}):
        if key.lower().startswith(FORBIDDEN) or 'backfilled' in key.lower(): raise ValueError('forbidden_feature')
    if row.get('split') not in ('train','validation','holdout','shadow'): raise ValueError('split_invalid')
    return row
def validate_forecast_output(payload):
    rows = payload.get('rows', [payload])
    for row in rows:
        if 'pointIndex' in row and not 1 <= int(row['pointIndex']) <= 96: raise ValueError('point_index_invalid')
        if not float(row['p10']) <= float(row['p50']) <= float(row['p90']): raise ValueError('quantile_order_invalid')
    return payload
def validate_forecast(payload): return validate_forecast_output(payload)
def emit(payload): print(json.dumps(validate_forecast_output(payload), ensure_ascii=False))
