import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openTradingEvidenceStore } from '../../lib/trading-evidence-store.mjs';

const extraction = JSON.parse(execFileSync(
  'C:/Users/R/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',
  ['-X', 'utf8', 'output/backfill-repair-20260904/extract-settlement-facts.py'],
  { encoding: 'utf8', maxBuffer: 50_000_000, windowsHide: true },
));
if (extraction.errors.length) throw new Error(JSON.stringify(extraction.errors));
const fieldSummary = {};
for (const day of extraction.days) {
  for (const [field, count] of Object.entries(day.coverage)) {
    const summary = fieldSummary[field] ||= { completeDays: 0, points: 0 };
    summary.completeDays += Number(count === 96);
    summary.points += count;
  }
}
console.log(JSON.stringify({ verifiedDays: extraction.days.length, fields: fieldSummary }));
if (process.argv.includes('--apply')) {
  const store = openTradingEvidenceStore({ filePath: 'C:/Users/R/AppData/Local/ElectricTradingAI/data/trading-evidence.sqlite' });
  const capturedAt = new Date().toISOString();
  let inserted = 0;
  let skippedDays = 0;
  try {
    for (const day of extraction.days) {
      if (!day.values.length) continue;
      const sourceId = 'SETTLEMENT-XLSX';
      const sourceRevision = `settlement-headers-v1:${day.sourceSha256}:${day.sourceSheet}`;
      const captureId = sourceRevision;
      if (store.queryCaptures({ sourceId, businessDate: day.businessDate, limit: 1000 }).some(c => c.id === captureId)) {
        skippedDays += 1;
        continue;
      }
      const facts = day.values.map(({ fieldId, pointIndex, value, unit }) => ({
        sourceId, fieldId, pointIndex, value, unit, businessDate: day.businessDate,
        sourceRevision, availableAt: capturedAt, capturedAt,
      }));
      store.transaction(() => {
        store.appendCapture({
          id: captureId, sourceId, businessDate: day.businessDate,
          pageUrl: `local-export:${encodeURIComponent(day.sourceFile)}`,
          capturedAt, accepted: true, rowCount: facts.length,
          contentSha256: createHash('sha256').update(JSON.stringify(day.values)).digest('hex'),
          evidence: {
            sourceFile: day.sourceFile, sourceSheet: day.sourceSheet, sourceFileSha256: day.sourceSha256,
            title: day.title, columnMappings: day.columns, coverageByField: day.coverage,
            sourceCells: day.values.map(v => ({ fieldId: v.fieldId, pointIndex: v.pointIndex, cell: v.sourceCell })),
            validation: '原始合并表头匹配；96个连续时段；电价乘偏差电量与同组电费逐点核对；空值未补零',
            availabilityBasis: '首次核验入库时间；未把事后结算文件伪装成当时已发布的预测',
            scope: '历史结算数据，不能替代当前持仓、可交易限额或原始成交明细',
          },
        });
        inserted += store.appendFacts(facts).inserted;
      });
    }
    console.log(JSON.stringify({ insertedFacts: inserted, skippedDays, capturedAt }));
  } finally {
    store.close();
  }
}
