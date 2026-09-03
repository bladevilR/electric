import json
def validate_forecast(payload):
    rows=payload.get("rows",[])
    for row in rows:
        if not 1 <= int(row["pointIndex"]) <= 96: raise ValueError("point_index_invalid")
        if not row["p10"] <= row["p50"] <= row["p90"]: raise ValueError("quantiles_not_monotonic")
    return payload
def emit(payload): print(json.dumps(validate_forecast(payload),ensure_ascii=False))
