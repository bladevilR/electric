import { DatabaseSync } from 'node:sqlite';

const captureId = 'settlement-headers-v1:aa5bf77b5252a8409d3cc8193e5c7926040c85dbfca9324d1679b0bd9e458a26:18';
const database = new DatabaseSync('C:/Users/R/AppData/Local/ElectricTradingAI/data/trading-evidence.sqlite');
const reason = '11月文件第18日页签的原始标题写为2025年10月18日；日期冲突，待原始来源确认；不参与正式历史数据。';
const quarantinedAt = new Date().toISOString();
try {
  database.exec('BEGIN IMMEDIATE');
  const capture = database.prepare('SELECT * FROM raw_captures WHERE id=? AND source_id=? AND business_date=?')
    .get(captureId, 'SETTLEMENT-XLSX', '2025-10-18');
  if (!capture) throw new Error('Exact capture not found');
  const evidence = JSON.parse(capture.evidence_json);
  if (!evidence.sourceFile.endsWith('4、2025年11月现货核对单 .xlsx') || evidence.sourceSheet !== '18') throw new Error('Source mismatch');
  const count = database.prepare('SELECT COUNT(*) AS n FROM facts WHERE source_id=? AND business_date=? AND source_revision=?')
    .get('SETTLEMENT-XLSX', '2025-10-18', captureId).n;
  if (capture.accepted === 0 && count === 0) {
    database.exec('ROLLBACK');
    console.log('Already quarantined');
  } else {
    database.prepare('INSERT INTO quarantined_facts SELECT facts.*,?,? FROM facts WHERE source_id=? AND business_date=? AND source_revision=?')
      .run(reason, quarantinedAt, 'SETTLEMENT-XLSX', '2025-10-18', captureId);
    database.prepare('INSERT INTO quarantined_captures SELECT raw_captures.*,?,? FROM raw_captures WHERE id=?').run(reason, quarantinedAt, captureId);
    const backupCount = database.prepare('SELECT COUNT(*) AS n FROM quarantined_facts WHERE source_revision=?').get(captureId).n;
    if (backupCount !== count) throw new Error('Backup count mismatch');
    database.prepare('DELETE FROM facts WHERE source_id=? AND business_date=? AND source_revision=?')
      .run('SETTLEMENT-XLSX', '2025-10-18', captureId);
    database.prepare('UPDATE raw_captures SET accepted=0,row_count=0,evidence_json=? WHERE id=?')
      .run(JSON.stringify({ ...evidence, reasonCode: 'source_date_conflict', reason, quarantinedAt }), captureId);
    database.exec('COMMIT');
    console.log(JSON.stringify({ quarantinedFacts: count, backupVerified: true, reason }));
  }
} catch (error) {
  if (database.isTransaction) database.exec('ROLLBACK');
  throw error;
} finally {
  database.close();
}
