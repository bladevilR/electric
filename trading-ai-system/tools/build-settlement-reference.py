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


def summarize_sheet(name, worksheet, shared_strings):
    dimension = worksheet.find("a:dimension", NS)
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

    for values in worksheet_rows(worksheet, shared_strings):
        non_empty_rows += 1
        if sum(1 for value in values if is_numeric(value)) >= 3:
            numeric_rows += 1
        if len(sample_rows) < 4:
            sample_rows.append(values[:16])

        if values and TIME_POINT_RE.fullmatch(str(values[0]).strip()):
            point_rows += 1
            load_value = numeric(values[1] if len(values) > 1 else "")
            settlement_value = numeric(values[14] if len(values) > 14 else "")
            price_value = numeric(values[15] if len(values) > 15 else "")
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
            "canFillActualKwh": False,
            "canFillSettleAmount": False,
            "badDailySheets": [],
            "referenceStrength": workbook_reference_strength(kind, 0),
        }

    sheets = workbook_sheets(path)
    kind = classify_workbook(path, sheets)
    valid_daily = [sheet for sheet in sheets if valid_daily_sheet(sheet)]
    coverage = infer_coverage(path)
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
        "featureRowCount": len(feature_rows),
        "canFillActualKwh": actual_rows > 0,
        "canFillSettleAmount": settlement_rows > 0,
        "badDailySheets": bad_daily,
        "referenceStrength": workbook_reference_strength(kind, len(valid_daily)),
        "featureRows": feature_rows,
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


def read_transaction_calculation_standardized(project_root):
    base = project_root / "data" / "jspec" / "standardized" / "transaction_calculation"
    usage_path = base / "customer_usage_96.csv"
    submission_path = base / "submission_power_96.csv"
    usage_rows = read_csv_dicts(usage_path)
    submission_rows = read_csv_dicts(submission_path)
    feature_rows = []

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

    dates = sorted({row["date"] for row in feature_rows if row.get("date")})
    return {
        "summary": {
            "usageRows": len(usage_rows),
            "usageTotalRows": sum(1 for row in usage_rows if normalize_bool(row.get("is_total"))),
            "submissionRows": len(submission_rows),
            "featureRowCount": len(feature_rows),
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
        ],
        "featureRows": feature_rows,
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
            "transactionCalculationFeatureRowCount": transaction_standardized["summary"]["featureRowCount"],
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
        "transactionCalculationStandardized": transaction_standardized,
        "manualExports": manual_exports,
        "usageBoundaries": [
            "历史核对单可以补历史 96 点实际负荷和结算标签，但不能代表目标交易日已经有数据。",
            "Excel 核对单中的用电量单位为 MWh，进入 actualKwh 前必须乘以 1000。",
            "交易计算表标准化 CSV 可以补部分月末历史实际用电和申报功率，但不能替代目标日持仓和交易限额。",
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
