import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ASSET_KEYS = [
  'realtimeAveragePrices',
  'dayAheadPublicClearing',
  'dayAheadUserClearing',
  'realtimePublicClearing',
  'userBid96',
  'userDefaultBid96',
  'systemLoadForecasts',
  'actualSystemLoads',
  'actualUserLoads',
  'contractsCurrent',
  'contractsHistory',
  'tradeSequences',
];

function cleanString(value) {
  return value == null ? '' : String(value).trim();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function endpointOf(capture = {}) {
  return cleanString(capture.meta?.url || capture.url);
}

function targetIdOf(capture = {}, fallback = '') {
  return cleanString(capture.businessTarget?.id || fallback);
}

function dataOf(capture = {}) {
  return capture.bodyJson?.data;
}

function listFromData(data) {
  if (Array.isArray(data)) {
    return data;
  }
  if (Array.isArray(data?.list)) {
    return data.list;
  }
  if (Array.isArray(data?.records)) {
    return data.records;
  }
  if (Array.isArray(data?.rows)) {
    return data.rows;
  }
  if (Array.isArray(data?.list?.list)) {
    return data.list.list;
  }
  return null;
}

function totalFromData(data) {
  const direct = numberOrNull(data?.total);
  if (direct !== null) {
    return direct;
  }
  const nested = numberOrNull(data?.list?.total);
  return nested;
}

function isEmptyResult(data) {
  const total = totalFromData(data);
  if (total !== null) {
    return total === 0;
  }
  const list = listFromData(data);
  return Array.isArray(list) && list.length === 0;
}

function classifyEndpoint(endpoint) {
  if (/realTimeClearingRelease\/queryRealTimeMarAvePricePublic/i.test(endpoint)) {
    return 'realtimeAveragePrices';
  }
  if (/dayClearingResult\/queryTableXrdOnlyJiesuan/i.test(endpoint)) {
    return 'dayAheadPublicClearing';
  }
  if (/Dd2jyUserClearingResult\/queryDd2jyRqClearing/i.test(endpoint)) {
    return 'dayAheadUserClearing';
  }
  if (/curClearingResult\/queryTableXrdOnlyJiesuan/i.test(endpoint)) {
    return 'realtimePublicClearing';
  }
  if (/mosEnergyBidInfoUser\/getMosEnergyBidInfoUserDefault/i.test(endpoint)) {
    return 'userDefaultBid96';
  }
  if (/mosEnergyBidInfoUser\/getMosEnergyBidInfoUser(?!Default|MonthSummary)/i.test(endpoint)) {
    return 'userBid96';
  }
  if (/glbecoParamvalue\/(?:getCurve|getGlbtraLfExtPubBo)/i.test(endpoint)) {
    return 'systemLoadForecasts';
  }
  if (/afterDiscloseInformation\/queryTableActualSystemLoad/i.test(endpoint)) {
    return 'actualSystemLoads';
  }
  if (/electricity\/queryDailyElectricity/i.test(endpoint)) {
    return 'actualUserLoads';
  }
  if (/contractApi\/getContractListByIdTime/i.test(endpoint)) {
    return 'contractsHistory';
  }
  if (/contractApi\/getContractListById/i.test(endpoint)) {
    return 'contractsCurrent';
  }
  if (/tradeNotice\/(?:queryTradeInfoListByTypeAndUser|queryTradeInfoByTypeAndUser)/i.test(endpoint)) {
    return 'tradeSequences';
  }
  return '';
}

function extractPointValueRows(data, prefix = 'value') {
  const rows = [];
  const list = listFromData(data) || [];
  list.forEach((item) => {
    Object.entries(item || {}).forEach(([key, value]) => {
      const match = key.match(new RegExp(`^${prefix}(\\d{1,2})$`, 'i'));
      if (match && value !== null && value !== undefined && value !== '') {
        rows.push({
          ...item,
          pointIndex: Number(match[1]),
          pointValue: value,
          pointField: key,
        });
      }
    });
  });
  return rows;
}

function extractObjectArrayRows(data) {
  const rows = [];
  Object.entries(data || {}).forEach(([key, value]) => {
    if (!Array.isArray(value)) {
      return;
    }
    value.forEach((item, index) => {
      rows.push({
        seriesKey: key,
        pointIndex: index + 1,
        value: item,
      });
    });
  });
  return rows;
}

function extractAssetRows(assetKey, data) {
  if (!data) {
    return [];
  }

  if (assetKey === 'systemLoadForecasts') {
    const rows = Array.isArray(data) ? data : extractObjectArrayRows(data);
    if (rows.length) {
      return rows;
    }
  }

  if (assetKey === 'actualSystemLoads') {
    const valueRows = extractPointValueRows(data, 'value');
    if (valueRows.length) {
      return valueRows;
    }
  }

  if (assetKey === 'userBid96' || assetKey === 'userDefaultBid96') {
    if (Array.isArray(data?.mosDeratePendParamList)) {
      return data.mosDeratePendParamList.map((row) => ({
        ...row,
        parentDataTime: data.dataTime,
      }));
    }
  }

  if (assetKey === 'actualUserLoads') {
    return Array.isArray(data?.list?.list) ? data.list.list : [];
  }

  return listFromData(data) || [];
}

function powerShellSafeJsonKeys(value) {
  if (Array.isArray(value)) {
    return value.map((item) => powerShellSafeJsonKeys(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const seen = new Map();
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const lowerKey = key.toLocaleLowerCase();
      const count = seen.get(lowerKey) || 0;
      seen.set(lowerKey, count + 1);
      const safeKey = count === 0 ? key : `${key}_caseVariant${count > 1 ? count : ''}`;
      return [safeKey, powerShellSafeJsonKeys(item)];
    })
  );
}

function assetRecord(capture, assetKey, raw, rowIndex = 0) {
  const endpoint = endpointOf(capture);
  return {
    sourceFile: cleanString(capture.fileName) || path.basename(cleanString(capture.filePath)),
    endpoint,
    capturedAt: cleanString(capture.meta?.capturedAt),
    targetId: targetIdOf(capture, assetKey),
    rowIndex,
    raw: powerShellSafeJsonKeys(raw),
  };
}

function createEmptyAssets() {
  return Object.fromEntries(ASSET_KEYS.map((key) => [key, []]));
}

function addEmptyEvidence(evidence, capture, kind) {
  evidence.emptySources.push({
    sourceFile: cleanString(capture.fileName) || path.basename(cleanString(capture.filePath)),
    endpoint: endpointOf(capture),
    capturedAt: cleanString(capture.meta?.capturedAt),
    targetId: targetIdOf(capture, kind),
    kind,
  });
}

function summarize(assets, evidence) {
  const contractCurrentTotal = Math.max(
    0,
    ...assets.contractsCurrent.map((item) => numberOrNull(item.raw?.__sourceTotal)).filter((value) => value !== null)
  );
  const contractHistoryTotal = Math.max(
    0,
    ...assets.contractsHistory.map((item) => numberOrNull(item.raw?.__sourceTotal)).filter((value) => value !== null)
  );

  return {
    realtimeAveragePriceRows: assets.realtimeAveragePrices.length,
    dayAheadPublicClearingRows: assets.dayAheadPublicClearing.length,
    dayAheadUserClearingRows: assets.dayAheadUserClearing.length,
    realtimePublicClearingRows: assets.realtimePublicClearing.length,
    userBidRows: assets.userBid96.length,
    userDefaultBidRows: assets.userDefaultBid96.length,
    systemLoadForecastRows: assets.systemLoadForecasts.length,
    actualSystemLoadRows: assets.actualSystemLoads.length,
    actualUserLoadRows: assets.actualUserLoads.length,
    contractCurrentTotal,
    contractCurrentCapturedRows: assets.contractsCurrent.length,
    contractHistoryTotal,
    contractHistoryCapturedRows: assets.contractsHistory.length,
    tradeSequenceRows: assets.tradeSequences.length,
    emptyActualLoadEndpoints: evidence.emptySources.filter((item) => item.kind === 'actual_load').length,
    emptySettlementEndpoints: evidence.emptySources.filter((item) => item.kind === 'settlement').length,
  };
}

export function buildDataAssetInventory(captures = []) {
  const assets = createEmptyAssets();
  const evidence = {
    emptySources: [],
    partialSources: [],
  };

  captures.forEach((capture) => {
    const endpoint = endpointOf(capture);
    const data = dataOf(capture);
    const assetKey = classifyEndpoint(endpoint);

    if (/electricity\/queryDailyElectricity/i.test(endpoint) && isEmptyResult(data)) {
      addEmptyEvidence(evidence, capture, 'actual_load');
    }
    if (/(tranDeclare\/queryDaySettleResult|tranDeclare\/queryMonthSettleResult|fileDown\/queryFileList)/i.test(endpoint) && isEmptyResult(data)) {
      addEmptyEvidence(evidence, capture, 'settlement');
    }
    if (!assetKey) {
      return;
    }

    const rows = extractAssetRows(assetKey, data);
    const total = totalFromData(data);
    rows.forEach((row, index) => {
      const raw = total !== null ? { ...row, __sourceTotal: total } : row;
      assets[assetKey].push(assetRecord(capture, assetKey, raw, index));
    });

    if ((assetKey === 'contractsCurrent' || assetKey === 'contractsHistory') && total !== null && total > rows.length) {
      evidence.partialSources.push({
        sourceFile: cleanString(capture.fileName) || path.basename(cleanString(capture.filePath)),
        endpoint,
        capturedAt: cleanString(capture.meta?.capturedAt),
        targetId: targetIdOf(capture, assetKey),
        total,
        capturedRows: rows.length,
      });
    }
  });

  return {
    generatedAt: new Date().toISOString(),
    summary: summarize(assets, evidence),
    assets,
    evidence,
  };
}

async function walkJsonFiles(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkJsonFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(fullPath);
    }
  }
  return files;
}

export async function readCaptureDirectory(directoryPath) {
  let files;
  try {
    files = await walkJsonFiles(directoryPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const captures = [];
  for (const filePath of files) {
    let capture;
    try {
      capture = JSON.parse(await readFile(filePath, 'utf8'));
    } catch {
      continue;
    }
    if (!capture?.meta?.url || !Object.hasOwn(capture, 'bodyJson')) {
      continue;
    }
    captures.push({
      ...capture,
      fileName: capture.fileName || path.basename(filePath),
      filePath,
    });
  }
  return captures;
}

export async function buildInventoryFromDirectories(directoryPaths = []) {
  const nestedCaptures = await Promise.all(directoryPaths.map((directoryPath) => readCaptureDirectory(directoryPath)));
  return buildDataAssetInventory(nestedCaptures.flat());
}
