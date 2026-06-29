import argparse
import csv
import json
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
import xml.etree.ElementTree as ET

NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

TIME_POINT_RE = re.compile(r"^\d{1,2}:\d{2}$")
NUMERIC_RE = re.compile(r"-?\d+(\.\d+)?(E-?\d+)?", re.I)


def read_shared_strings(archive):
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    return ["".join(text.text or "" for text in item.findall(".//a:t", NS)) for item in root.findall("a:si", NS)]


def cell_value(cell, shared_strings):
    value = cell.find("a:v", NS)
    if value is None:
        inline = cell.find("a:is", NS)
        if inline is not None:
            return "".join(text.text or "" for text in inline.findall(".//a:t", NS))
        return ""
    if cell.attrib.get("t") == "s":
        try:
            return shared_strings[int(value.text)]
        except Exception:
            return value.text or ""
    return value.text or ""


def is_numeric(value):
    return bool(NUMERIC_RE.fullmatch(str(value).strip()))


def numeric(value):
    try:
        text = str(value).strip()
        if not text:
            return None
        return float(text)
    except Exception:
        return None


def round_number(value, digits=6):
    number = numeric(value)
    if number is None:
        return None
    return round(number, digits)


def column_index(cell_ref):
    match = re.match(r"([A-Z]+)\d+", cell_ref or "")
    if not match:
        return None
    index = 0
    for char in match.group(1):
        index = index * 26 + ord(char) - ord("A") + 1
    return index


def worksheet_rows(worksheet, shared_strings):
    for row in worksheet.findall("a:sheetData/a:row", NS):
        cells = {}
        for cell in row.findall("a:c", NS):
            index = column_index(cell.attrib.get("r", ""))
            if index is not None:
                cells[index] = cell_value(cell, shared_strings)
        if not cells:
            continue
        values = [cells.get(index, "") for index in range(1, max(cells) + 1)]
        if any(str(value).strip() for value in values):
            yield values


def header_index(rows, label, default=None):
    header_a = rows[4] if len(rows) > 4 else []
    header_b = rows[5] if len(rows) > 5 else []
    candidates = []
    width = max(len(header_a), len(header_b))
    for index in range(width):
        first = header_a[index] if index < len(header_a) else ""
        second = header_b[index] if index < len(header_b) else ""
        text = f"{first or ''}{second or ''}"
        if label in text:
            candidates.append(index)
    return candidates[-1] if candidates else default


def row_number(values, index):
    if index is None or index < 0 or index >= len(values):
        return None
    return numeric(values[index])


def summarize_sheet(name, worksheet, shared_strings):
    dimension = worksheet.find("a:dimension", NS)
    rows = list(worksheet_rows(worksheet, shared_strings))
    sample_rows = []
    non_empty_rows = 0
    numeric_rows = 0
    point_rows = 0
    actual_load_points = 0
    settlement_amount_points = 0
    settlement_price_points = 0
    actual_load_mwh = 0.0
    settlement_amount_yuan = 0.0
    point_values = []
    settlement_amount_index = header_index(rows, "交易电费", 14)
    settlement_price_index = header_index(rows, "交易单价", 15)
    day_ahead_forecast_index = header_index(rows, "日前曲线预估", 16)
    day_ahead_actual_ratio_index = header_index(rows, "日前/实际", 17)
    out_of_band_index = header_index(rows, "低于95", 18)
    total_trade_saving_index = header_index(rows, "交易节约费用", 28)

    for values in rows:
        non_empty_rows += 1
        if sum(1 for value in values if is_numeric(value)) >= 3:
            numeric_rows += 1
        if len(sample_rows) < 4:
            sample_rows.append(values[:16])

        if values and TIME_POINT_RE.fullmatch(str(values[0]).strip()):
            point_rows += 1
            load_value = numeric(values[1] if len(values) > 1 else "")
            settlement_value = row_number(values, settlement_amount_index)
            price_value = row_number(values, settlement_price_index)
            if load_value is not None:
                actual_load_points += 1
                actual_load_mwh += load_value
            if settlement_value is not None:
                settlement_amount_points += 1
                settlement_amount_yuan += settlement_value
            if price_value is not None:
                settlement_price_points += 1
            point_values.append(
                {
                    "pointIndex": point_rows,
                    "timePoint": str(values[0]).strip(),
                    "actualLoadMwh": load_value,
                    "settlementAmountYuan": settlement_value,
                    "settlementPrice": price_value,
                    "longTermContractMwh": row_number(values, 2),
                    "longTermContractFeeYuan": row_number(values, 3),
                    "energyBlockMwh": row_number(values, 4),
                    "energyBlockFeeYuan": row_number(values, 5),
                    "dayAheadDeviationMwh": row_number(values, 8),
                    "dayAheadDeviationPrice": row_number(values, 9),
                    "dayAheadDeviationFeeYuan": row_number(values, 10),
                    "realtimeDeviationMwh": row_number(values, 11),
                    "realtimeDeviationPrice": row_number(values, 12),
                    "realtimeDeviationFeeYuan": row_number(values, 13),
                    "dayAheadForecastMwh": row_number(values, day_ahead_forecast_index),
                    "dayAheadActualRatio": row_number(values, day_ahead_actual_ratio_index),
                    "outOfBandMwh": row_number(values, out_of_band_index),
                    "totalTradeSavingYuan": row_number(values, total_trade_saving_index),
                }
            )

    return {
        "name": name,
        "dimension": dimension.attrib.get("ref", "") if dimension is not None else "",
        "nonEmptyRows": non_empty_rows,
        "numericRows": numeric_rows,
        "pointRows": point_rows,
        "actualLoadPoints": actual_load_points,
        "settlementAmountPoints": settlement_amount_points,
        "settlementPricePoints": settlement_price_points,
        "actualLoadMwh": round(actual_load_mwh, 6),
        "settlementAmountYuan": round(settlement_amount_yuan, 6),
        "sampleRows": sample_rows,
        "_pointValues": point_values,
    }


def workbook_sheets(workbook_path):
    with zipfile.ZipFile(workbook_path) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rid_to_target = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
        shared_strings = read_shared_strings(archive)
        sheets = []

        for sheet in workbook.find("a:sheets", NS):
            name = sheet.attrib.get("name", "")
            rid = sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
            target = rid_to_target[rid].lstrip("/")
            if not target.startswith("xl/"):
                target = "xl/" + target
            worksheet = ET.fromstring(archive.read(target))
            sheets.append(summarize_sheet(name, worksheet, shared_strings))
        return sheets


def parse_month_label(value):
    text = str(value or "").strip()
    match = re.fullmatch(r"(\d{1,2})月", text)
    if not match:
        return None
    month = int(match.group(1))
    return month if 1 <= month <= 12 else None


def monthly_overview_rows(workbook_path):
    if workbook_path.suffix.lower() != ".xlsx":
        return []
    rows = []
    try:
        with zipfile.ZipFile(workbook_path) as archive:
            workbook = ET.fromstring(archive.read("xl/workbook.xml"))
            rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
            rid_to_target = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
            shared_strings = read_shared_strings(archive)
            for sheet in workbook.find("a:sheets", NS):
                sheet_name = sheet.attrib.get("name", "")
                year_match = re.fullmatch(r"(20\d{2})年", sheet_name)
                if not year_match:
                    continue
                rid = sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
                target = rid_to_target[rid].lstrip("/")
                if not target.startswith("xl/"):
                    target = "xl/" + target
                worksheet = ET.fromstring(archive.read(target))
                year = int(year_match.group(1))
                for values in worksheet_rows(worksheet, shared_strings):
                    month = parse_month_label(values[0] if values else "")
                    if month is None:
                        continue
                    actual_energy = row_number(values, 31)
                    if actual_energy is None:
                        continue
                    rows.append(
                        {
                            "year": year,
                            "month": month,
                            "monthLabel": f"{month}月",
                            "monthKey": f"{year}-{month:02d}",
                            "actualSettlementEnergyWanKwh": round_number(actual_energy, 4),
                            "settlementPriceYuanPerKwh": round_number(row_number(values, 30), 6),
                            "gridProxyPriceYuanPerKwh": round_number(row_number(values, 8), 6),
                            "spotShare": round_number(row_number(values, 32), 6),
                            "savingVsMarketUserWanYuan": round_number(row_number(values, 38), 4),
                            "savingVsMarketTotalWanYuan": round_number(row_number(values, 40), 4),
                            "savingVsGridWanYuan": round_number(row_number(values, 42), 4),
                            "sourceFile": workbook_path.name,
                            "sourceSheet": sheet_name,
                        }
                    )
    except Exception:
        return []
    return rows


def is_daily_sheet(sheet):
    return bool(re.fullmatch(r"\d{1,2}", sheet.get("name", "")))


def valid_daily_sheet(sheet):
    return (
        is_daily_sheet(sheet)
        and sheet.get("pointRows") == 96
        and sheet.get("actualLoadPoints") == 96
        and sheet.get("settlementAmountPoints") == 96
        and sheet.get("actualLoadMwh", 0) > 0
    )


def infer_coverage(path):
    match = re.search(r"(20\d{2})年\s*(\d{1,2})月", path.name)
    if not match:
        match = re.search(r"(20\d{2}).*?(\d{1,2})月", path.name)
    if not match:
        return {}
    return {
        "year": int(match.group(1)),
        "month": int(match.group(2)),
    }


def date_for_daily_sheet(coverage, sheet_name):
    try:
        year = int(coverage.get("year"))
        month = int(coverage.get("month"))
        day = int(sheet_name)
        return datetime(year, month, day).date().isoformat()
    except Exception:
        return ""


def classify_workbook(path, sheets):
    sheet_names = {sheet["name"] for sheet in sheets}
    if path.suffix.lower() == ".xls" and "交易计算表" in path.name:
        return "transaction_calculation"
    if "交易电量" in path.name or any(re.fullmatch(r"20\d{2}年", name) for name in sheet_names):
        return "monthly_settlement_overview"
    if "现货核对单" in path.name or any(valid_daily_sheet(sheet) for sheet in sheets) or {"合约日清分", "偏差收益回收"} & sheet_names:
        return "spot_reconciliation"
    return "workbook_reference"


def workbook_reference_strength(kind, valid_daily_count):
    if kind == "spot_reconciliation" and valid_daily_count:
        return "historical_96_point_truth"
    if kind == "spot_reconciliation":
        return "point_like_reference"
    if kind == "transaction_calculation":
        return "transaction_calculation_reference"
    if kind == "monthly_settlement_overview":
        return "monthly_summary"
    return "workbook_reference"


def workbook_record(path):
    if path.suffix.lower() == ".xls":
        kind = classify_workbook(path, [])
        return {
            "fileName": path.name,
            "path": str(path),
            "format": "xls",
            "kind": kind,
            "parseStatus": "listed_only",
            "sheets": [],
            "coverage": infer_coverage(path),
            "validDailySheetCount": 0,
            "actualKwhRows": 0,
            "settleAmountRows": 0,
            "extraPointMetricRows": 0,
            "monthlyOverviewRowCount": 0,
            "monthlyOverviewMonths": [],
            "canFillActualKwh": False,
            "canFillSettleAmount": False,
            "badDailySheets": [],
            "referenceStrength": workbook_reference_strength(kind, 0),
            "monthlyOverviewRows": [],
        }

    sheets = workbook_sheets(path)
    kind = classify_workbook(path, sheets)
    valid_daily = [sheet for sheet in sheets if valid_daily_sheet(sheet)]
    coverage = infer_coverage(path)
    monthly_rows = monthly_overview_rows(path) if kind == "monthly_settlement_overview" else []
    feature_rows = []
    for sheet in valid_daily:
        date = date_for_daily_sheet(coverage, sheet["name"])
        if not date:
            continue
        for point in sheet.get("_pointValues", []):
            load_mwh = point.get("actualLoadMwh")
            settlement_yuan = point.get("settlementAmountYuan")
            if load_mwh is None or settlement_yuan is None:
                continue
            feature_rows.append(
                {
                    "date": date,
                    "pointIndex": point.get("pointIndex"),
                    "timePoint": point.get("timePoint", ""),
                    "actualKwh": round(load_mwh * 1000, 6),
                    "settleAmount": settlement_yuan,
                    "settlementPrice": point.get("settlementPrice"),
                    "longTermContractMwh": point.get("longTermContractMwh"),
                    "longTermContractFeeYuan": point.get("longTermContractFeeYuan"),
                    "energyBlockMwh": point.get("energyBlockMwh"),
                    "energyBlockFeeYuan": point.get("energyBlockFeeYuan"),
                    "dayAheadDeviationMwh": point.get("dayAheadDeviationMwh"),
                    "dayAheadDeviationPrice": point.get("dayAheadDeviationPrice"),
                    "dayAheadDeviationFeeYuan": point.get("dayAheadDeviationFeeYuan"),
                    "realtimeDeviationMwh": point.get("realtimeDeviationMwh"),
                    "realtimeDeviationPrice": point.get("realtimeDeviationPrice"),
                    "realtimeDeviationFeeYuan": point.get("realtimeDeviationFeeYuan"),
                    "dayAheadForecastMwh": point.get("dayAheadForecastMwh"),
                    "dayAheadActualRatio": point.get("dayAheadActualRatio"),
                    "outOfBandMwh": point.get("outOfBandMwh"),
                    "totalTradeSavingYuan": point.get("totalTradeSavingYuan"),
                    "sourceFile": path.name,
                    "sourceSheet": sheet["name"],
                }
            )
    for sheet in sheets:
        sheet.pop("_pointValues", None)
    bad_daily = [
        {
            "name": sheet["name"],
            "pointRows": sheet.get("pointRows", 0),
            "actualLoadPoints": sheet.get("actualLoadPoints", 0),
            "settlementAmountPoints": sheet.get("settlementAmountPoints", 0),
        }
        for sheet in sheets
        if is_daily_sheet(sheet) and not valid_daily_sheet(sheet)
    ]
    actual_rows = len(valid_daily) * 96
    settlement_rows = len(valid_daily) * 96
    extra_metric_fields = [
        "dayAheadForecastMwh",
        "dayAheadActualRatio",
        "outOfBandMwh",
        "totalTradeSavingYuan",
    ]
    extra_point_metric_rows = sum(
        1
        for row in feature_rows
        if any(row.get(field) is not None for field in extra_metric_fields)
    )

    return {
        "fileName": path.name,
        "path": str(path),
        "format": "xlsx",
        "kind": kind,
        "parseStatus": "parsed",
        "sheets": sheets,
        "coverage": coverage,
        "validDailySheetCount": len(valid_daily),
        "actualKwhRows": actual_rows,
        "settleAmountRows": settlement_rows,
        "extraPointMetricRows": extra_point_metric_rows,
        "monthlyOverviewRowCount": len(monthly_rows),
        "monthlyOverviewMonths": [row["monthKey"] for row in monthly_rows],
        "featureRowCount": len(feature_rows),
        "canFillActualKwh": actual_rows > 0,
        "canFillSettleAmount": settlement_rows > 0,
        "badDailySheets": bad_daily,
        "referenceStrength": workbook_reference_strength(kind, len(valid_daily)),
        "featureRows": feature_rows,
        "monthlyOverviewRows": monthly_rows,
    }


def read_workbooks(project_root):
    paths = [
        path
        for path in project_root.iterdir()
        if path.is_file() and path.suffix.lower() in {".xlsx", ".xls"}
    ]
    return [workbook_record(path) for path in sorted(paths, key=lambda item: item.name)]


def read_manual_exports(project_root):
    exports = []
    base = project_root / "data" / "jspec" / "manual-exports"
    if not base.exists():
        return exports
    for manifest in sorted(base.glob("*/*/manifest.json")):
        try:
            payload = json.loads(manifest.read_text(encoding="utf-8"))
        except Exception:
            continue
        files = payload.get("files") if isinstance(payload.get("files"), list) else []
        exports.append(
            {
                "category": manifest.parent.name,
                "exportDate": payload.get("export_date") or manifest.parent.parent.name,
                "pageName": payload.get("page_name", ""),
                "fileCount": len(files),
                "files": files,
                "status": "files_available" if files else "empty_manifest",
                "containsCredentials": bool(payload.get("contains_credentials")),
                "manifestPath": str(manifest),
            }
        )
    return exports


def read_csv_dicts(path):
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def normalize_bool(value):
    return str(value).strip().lower() in {"true", "1", "yes", "y"}


def normalize_point(value):
    number = numeric(value)
    if number is None:
        return None
    point = int(number)
    return point if 1 <= point <= 96 else None


def metric_id(metric):
    text = str(metric or "")
    if "持仓量" in text:
        return "position_mwh"
    if "操作量1" in text:
        return "operation_1_mwh"
    if "操作量2" in text:
        return "operation_2_mwh"
    if "近三天用电量均值" in text:
        return "three_day_average_mwh"
    if "96点电力值" in text:
        return "power_mw"
    return "other"


def normalize_hour_index(value):
    number = numeric(value)
    if number is None:
        return None
    hour = int(number)
    return hour if 1 <= hour <= 24 else None


def read_transaction_calculation_standardized(project_root):
    base = project_root / "data" / "jspec" / "standardized" / "transaction_calculation"
    usage_path = base / "customer_usage_96.csv"
    submission_path = base / "submission_power_96.csv"
    hourly_summary_path = base / "hourly_summary_rows.csv"
    hourly_transaction_path = base / "hourly_transaction.csv"
    usage_rows = read_csv_dicts(usage_path)
    submission_rows = read_csv_dicts(submission_path)
    hourly_summary_rows = read_csv_dicts(hourly_summary_path)
    hourly_transaction_rows = read_csv_dicts(hourly_transaction_path)
    feature_rows = []
    hourly_business_rows = []

    for row in usage_rows:
        if not normalize_bool(row.get("is_total")):
            continue
        date = row.get("usage_date", "").strip()
        point = normalize_point(row.get("point_index"))
        value = numeric(row.get("energy_kwh"))
        if not date or point is None or value is None:
            continue
        feature_rows.append(
            {
                "date": date,
                "pointIndex": point,
                "timePoint": row.get("time_point", "").strip(),
                "actualKwh": value,
                "sourceFile": usage_path.name,
                "sourceEndpoint": "transaction-calculation-standardized",
                "sourceRowKind": "customer_usage_total",
                "sourceWorkbook": row.get("source_file", ""),
            }
        )

    for row in submission_rows:
        date = row.get("delivery_date", "").strip()
        point = normalize_point(row.get("point_index"))
        value = numeric(row.get("rounded_power_mw"))
        if value is None:
            value = numeric(row.get("power_mw"))
        if not date or point is None or value is None:
            continue
        feature_rows.append(
            {
                "date": date,
                "pointIndex": point,
                "timePoint": row.get("time_point", "").strip(),
                "declarationPower": value,
                "sourceFile": submission_path.name,
                "sourceEndpoint": "transaction-calculation-standardized",
                "sourceRowKind": "submission_power",
                "sourceWorkbook": row.get("source_file", ""),
            }
        )

    for row in hourly_summary_rows:
        hour_index = normalize_hour_index(row.get("hour_index"))
        value = numeric(row.get("value"))
        if hour_index is None or value is None:
            continue
        hourly_business_rows.append(
            {
                "exportMonth": row.get("export_month", "").strip(),
                "hourIndex": hour_index,
                "hourWindow": row.get("hour_window", "").strip(),
                "metric": row.get("metric", "").strip(),
                "metricId": metric_id(row.get("metric")),
                "valueMwh": value,
                "sourceFile": hourly_summary_path.name,
                "sourceWorkbook": row.get("source_file", ""),
                "sourceEndpoint": "transaction-calculation-standardized",
            }
        )

    dates = sorted({row["date"] for row in feature_rows if row.get("date")})
    position_rows = [row for row in hourly_business_rows if row["metricId"] == "position_mwh"]
    operation_rows = [
        row
        for row in hourly_business_rows
        if row["metricId"] in {"operation_1_mwh", "operation_2_mwh"}
    ]
    three_day_rows = [row for row in hourly_business_rows if row["metricId"] == "three_day_average_mwh"]
    power_rows = [row for row in hourly_business_rows if row["metricId"] == "power_mw"]
    return {
        "summary": {
            "usageRows": len(usage_rows),
            "usageTotalRows": sum(1 for row in usage_rows if normalize_bool(row.get("is_total"))),
            "submissionRows": len(submission_rows),
            "hourlySummaryRows": len(hourly_summary_rows),
            "hourlyTransactionRows": len(hourly_transaction_rows),
            "positionHourlyRows": len(position_rows),
            "operationHourlyRows": len(operation_rows),
            "threeDayAverageHourlyRows": len(three_day_rows),
            "powerHourlyRows": len(power_rows),
            "featureRowCount": len(feature_rows),
            "hourlyBusinessRowCount": len(hourly_business_rows),
            "featureDateCount": len(dates),
            "featureDates": dates,
        },
        "files": [
            {
                "path": str(usage_path),
                "fileName": usage_path.name,
                "rowCount": len(usage_rows),
                "status": "parsed" if usage_rows else "missing_or_empty",
            },
            {
                "path": str(submission_path),
                "fileName": submission_path.name,
                "rowCount": len(submission_rows),
                "status": "parsed" if submission_rows else "missing_or_empty",
            },
            {
                "path": str(hourly_summary_path),
                "fileName": hourly_summary_path.name,
                "rowCount": len(hourly_summary_rows),
                "status": "parsed" if hourly_summary_rows else "missing_or_empty",
            },
            {
                "path": str(hourly_transaction_path),
                "fileName": hourly_transaction_path.name,
                "rowCount": len(hourly_transaction_rows),
                "status": "parsed" if hourly_transaction_rows else "missing_or_empty",
            },
        ],
        "featureRows": feature_rows,
        "hourlyBusinessRows": hourly_business_rows,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", default=str(Path(__file__).resolve().parents[2]))
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    workbooks = read_workbooks(project_root)
    manual_exports = read_manual_exports(project_root)
    transaction_standardized = read_transaction_calculation_standardized(project_root)
    actual_files = sum(item["fileCount"] for item in manual_exports if item["category"] == "actual_daily_96")
    settlement_files = sum(item["fileCount"] for item in manual_exports if item["category"] == "settlement_files")
    position_files = sum(item["fileCount"] for item in manual_exports if item["category"] == "position_curve")
    spot_count = sum(1 for item in workbooks if item["kind"] == "spot_reconciliation")
    monthly_count = sum(1 for item in workbooks if item["kind"] == "monthly_settlement_overview")
    transaction_count = sum(1 for item in workbooks if item["kind"] == "transaction_calculation")
    transaction_actual_rows = transaction_standardized["summary"]["usageTotalRows"]
    transaction_feature_rows = transaction_standardized["featureRows"]
    actual_candidate_rows = sum(item.get("actualKwhRows", 0) for item in workbooks) + transaction_actual_rows
    settlement_candidate_rows = sum(item.get("settleAmountRows", 0) for item in workbooks)
    extra_point_metric_rows = sum(item.get("extraPointMetricRows", 0) for item in workbooks)
    monthly_overview_rows = [row for item in workbooks for row in item.get("monthlyOverviewRows", [])]
    feature_rows = transaction_feature_rows + [row for item in workbooks for row in item.get("featureRows", [])]

    result = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "workbookCount": len(workbooks),
            "spotReconciliationWorkbookCount": spot_count,
            "monthlySettlementWorkbookCount": monthly_count,
            "transactionCalculationWorkbookCount": transaction_count,
            "transactionCalculationUsageRows": transaction_standardized["summary"]["usageRows"],
            "transactionCalculationUsageTotalRows": transaction_standardized["summary"]["usageTotalRows"],
            "transactionCalculationSubmissionRows": transaction_standardized["summary"]["submissionRows"],
            "transactionCalculationHourlySummaryRows": transaction_standardized["summary"]["hourlySummaryRows"],
            "transactionCalculationHourlyTransactionRows": transaction_standardized["summary"]["hourlyTransactionRows"],
            "transactionCalculationPositionHourlyRows": transaction_standardized["summary"]["positionHourlyRows"],
            "transactionCalculationOperationHourlyRows": transaction_standardized["summary"]["operationHourlyRows"],
            "transactionCalculationThreeDayAverageHourlyRows": transaction_standardized["summary"]["threeDayAverageHourlyRows"],
            "transactionCalculationPowerHourlyRows": transaction_standardized["summary"]["powerHourlyRows"],
            "transactionCalculationFeatureRowCount": transaction_standardized["summary"]["featureRowCount"],
            "transactionCalculationHourlyBusinessRowCount": transaction_standardized["summary"]["hourlyBusinessRowCount"],
            "monthlyOverviewRows": len(monthly_overview_rows),
            "monthlyOverviewMonths": [row["monthKey"] for row in monthly_overview_rows],
            "extraPointMetricRows": extra_point_metric_rows,
            "manualManifestCount": len(manual_exports),
            "actualDaily96ExportFiles": actual_files,
            "settlementExportFiles": settlement_files,
            "positionExportFiles": position_files,
            "actualKwhCandidateRows": actual_candidate_rows,
            "settleAmountCandidateRows": settlement_candidate_rows,
            "featureRowCount": len(feature_rows),
            "hasSettlementReference": spot_count + monthly_count > 0,
            "canFillActualKwh": actual_files > 0 or actual_candidate_rows > 0,
            "canFillSettleAmount": settlement_files > 0 or settlement_candidate_rows > 0,
        },
        "workbooks": workbooks,
        "featureRows": feature_rows,
        "monthlyOverviewRows": monthly_overview_rows,
        "transactionCalculationStandardized": transaction_standardized,
        "manualExports": manual_exports,
        "usageBoundaries": [
            "历史核对单可以补历史 96 点实际负荷和结算标签，但不能代表目标交易日已经有数据。",
            "Excel 核对单中的用电量单位为 MWh，进入 actualKwh 前必须乘以 1000。",
            "交易计算表标准化 CSV 可以补部分月末历史实际用电和申报功率，但不能替代目标日持仓和交易限额。",
            "交易计算表小时持仓和操作量只能作为历史业务约束参考，不能替代目标日 position-96.csv 或 trade-limits.json。",
            "月度交易电量电价表只能做长期背景，不能当作日内点位结算标签。",
            "manual-export manifest 如果 files 为空，只表示已登记补采目标，不表示数据已经到位。",
        ],
        "upgradeHooks": [
            {"id": "actual_load_96", "reason": "历史核对单可补历史 actualKwh；目标日仍需导出用户实际 96 点日电量。"},
            {"id": "settle_day", "reason": "历史核对单可补历史 settleAmount；目标日仍需日结算或结算明细。"},
            {"id": "position_curve", "reason": "导出持仓曲线后可计算可买/可卖边界。"},
            {"id": "transaction_calculation", "reason": "交易计算表提供部分月末用电详情和提报电力曲线，可作为辅助校验。"},
        ],
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
