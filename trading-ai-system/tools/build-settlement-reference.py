import argparse
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


def read_shared_strings(archive):
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    values = []
    for item in root.findall("a:si", NS):
        values.append("".join(text.text or "" for text in item.findall(".//a:t", NS)))
    return values


def cell_value(cell, shared_strings):
    value = cell.find("a:v", NS)
    if value is None:
        inline = cell.find("a:is", NS)
        if inline is not None:
            return "".join(text.text or "" for text in inline.findall(".//a:t", NS))
        return ""
    if cell.attrib.get("t") == "s":
        return shared_strings[int(value.text)]
    return value.text or ""


def is_numeric(value):
    return bool(re.fullmatch(r"-?\d+(\.\d+)?(E-?\d+)?", str(value).strip(), re.I))


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
            dimension = worksheet.find("a:dimension", NS)
            sample_rows = []
            non_empty_rows = 0
            numeric_rows = 0

            for row in worksheet.findall("a:sheetData/a:row", NS):
                values = [cell_value(cell, shared_strings) for cell in row.findall("a:c", NS)]
                if not any(str(value).strip() for value in values):
                    continue
                non_empty_rows += 1
                if sum(1 for value in values if is_numeric(value)) >= 3:
                    numeric_rows += 1
                if len(sample_rows) < 4:
                    sample_rows.append(values[:16])

            sheets.append(
                {
                    "name": name,
                    "dimension": dimension.attrib.get("ref", "") if dimension is not None else "",
                    "nonEmptyRows": non_empty_rows,
                    "numericRows": numeric_rows,
                    "sampleRows": sample_rows,
                }
            )
        return sheets


def classify_workbook(path, sheets):
    names = {sheet["name"] for sheet in sheets}
    if {"合约日清分", "偏差收益回收"} & names:
        return "spot_reconciliation"
    if any(re.fullmatch(r"20\d{2}年.*", name) for name in names) or "交易电量" in path.name:
        return "monthly_settlement_overview"
    return "workbook_reference"


def read_workbooks(project_root):
    workbooks = []
    for path in sorted(project_root.glob("2026*.xlsx")):
        sheets = workbook_sheets(path)
        kind = classify_workbook(path, sheets)
        workbooks.append(
            {
                "fileName": path.name,
                "path": str(path),
                "kind": kind,
                "sheets": sheets,
                "referenceStrength": "point_like" if kind == "spot_reconciliation" else "monthly_summary",
            }
        )
    return workbooks


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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", default=str(Path(__file__).resolve().parents[2]))
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    workbooks = read_workbooks(project_root)
    manual_exports = read_manual_exports(project_root)
    actual_files = sum(item["fileCount"] for item in manual_exports if item["category"] == "actual_daily_96")
    settlement_files = sum(item["fileCount"] for item in manual_exports if item["category"] == "settlement_files")
    position_files = sum(item["fileCount"] for item in manual_exports if item["category"] == "position_curve")
    spot_count = sum(1 for item in workbooks if item["kind"] == "spot_reconciliation")
    monthly_count = sum(1 for item in workbooks if item["kind"] == "monthly_settlement_overview")

    result = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "workbookCount": len(workbooks),
            "spotReconciliationWorkbookCount": spot_count,
            "monthlySettlementWorkbookCount": monthly_count,
            "manualManifestCount": len(manual_exports),
            "actualDaily96ExportFiles": actual_files,
            "settlementExportFiles": settlement_files,
            "positionExportFiles": position_files,
            "hasSettlementReference": spot_count + monthly_count > 0,
            "canFillActualKwh": actual_files > 0,
            "canFillSettleAmount": settlement_files > 0,
        },
        "workbooks": workbooks,
        "manualExports": manual_exports,
        "usageBoundaries": [
            "Excel 核对单只能作为结算/偏差参考，不能替代 96 点实际负荷。",
            "月度交易电量电价表只能做长期背景，不能当作日内点位结算标签。",
            "manual-export manifest 如果 files 为空，只表示已登记补采目标，不表示数据已到位。",
        ],
        "upgradeHooks": [
            {"id": "actual_load_96", "reason": "导出用户实际 96 点日电量后可填充 actualKwh。"},
            {"id": "settle_day", "reason": "导出日结算明细后可填充 settleAmount 或结算标签。"},
            {"id": "position_curve", "reason": "导出持仓曲线后可计算可买/可卖边界。"},
        ],
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
