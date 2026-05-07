function unwrapData(bodyJson) {
  if (bodyJson == null) {
    return undefined;
  }

  if (Array.isArray(bodyJson)) {
    return bodyJson;
  }

  if (typeof bodyJson !== 'object') {
    return bodyJson;
  }

  for (const key of ['data', 'rows', 'list', 'records', 'result']) {
    if (Object.hasOwn(bodyJson, key)) {
      return bodyJson[key];
    }
  }

  return bodyJson;
}

function getDataKind(value) {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value === null) {
    return 'null';
  }
  return typeof value;
}

function getDataLength(value) {
  if (Array.isArray(value) || typeof value === 'string') {
    return value.length;
  }
  const nestedArray = findNestedArray(value);
  if (nestedArray?.length === 96) {
    return nestedArray.length;
  }
  return null;
}

function getSampleDataKeys(value) {
  const sample = getSampleDataObject(value);
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
    return [];
  }
  return Object.keys(sample).slice(0, 20);
}

function getAllSampleDataKeys(value) {
  const sample = getSampleDataObject(value);
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
    return [];
  }
  return Object.keys(sample);
}

function getSampleDataObject(value) {
  if (Array.isArray(value)) {
    return value.find((item) => item && typeof item === 'object');
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const nestedArrays = [
    value.list?.list,
    value.list?.records,
    value.rows,
    value.records,
    value.result,
  ];

  for (const items of nestedArrays) {
    if (Array.isArray(items)) {
      const sample = items.find((item) => item && typeof item === 'object');
      if (sample) {
        return sample;
      }
    }
  }

  const nestedArray = findNestedArray(value);
  if (nestedArray) {
    const sample = nestedArray.find((item) => item && typeof item === 'object');
    if (sample) {
      return sample;
    }
  }

  return value;
}

function findNestedArray(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const arrays = Object.values(value).filter(Array.isArray);
  const preferred = arrays.find((items) => items.length === 96);
  if (preferred) {
    return preferred;
  }

  if (arrays.length) {
    return arrays[0];
  }

  for (const child of Object.values(value)) {
    const nested = findNestedArray(child);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function getPath(value) {
  try {
    return new URL(value).pathname;
  } catch {
    return String(value ?? '');
  }
}

function countSequentialPointKeys(keys) {
  const prefixes = ['point', 'p', 'price', 'value'];
  let best = 0;

  for (const prefix of prefixes) {
    const numbers = new Set();
    const pattern = new RegExp(`^${prefix}(\\d+)$`, 'i');
    for (const key of keys) {
      const match = pattern.exec(key);
      if (match) {
        numbers.add(Number(match[1]));
      }
    }
    best = Math.max(best, numbers.size);
  }

  return best;
}

function getTableHeadPointCount(data) {
  const tableHead = data && typeof data === 'object' ? data.listTableHead : null;
  if (!Array.isArray(tableHead)) {
    return 0;
  }

  if (tableHead.length === 96) {
    return 96;
  }

  return countSequentialPointKeys(
    tableHead
      .map((item) => item?.prop)
      .filter((value) => typeof value === 'string')
  );
}

function getPointColumnCount(data, keys) {
  return Math.max(countSequentialPointKeys(keys), getTableHeadPointCount(data));
}

function looksLike96PointData(data, keys, pointColumnCount, dataLength) {
  if (Array.isArray(data) && data.length === 96) {
    return true;
  }

  const joinedKeys = keys.join(' ').toLowerCase();
  return (
    joinedKeys.includes('p96') ||
    joinedKeys.includes('96') ||
    joinedKeys.includes('timepoint') ||
    joinedKeys.includes('time_point') ||
    joinedKeys.includes('point') ||
    pointColumnCount >= 96 ||
    dataLength === 96
  );
}

export function buildInspectionRows(captures) {
  return captures.map((capture) => {
    const meta = capture.meta ?? {};
    const target = capture.businessTarget ?? {};
    const data = unwrapData(capture.bodyJson);
    const sampleDataKeys = getSampleDataKeys(data);
    const pointColumnCount = getPointColumnCount(data, getAllSampleDataKeys(data));
    const dataLength = getDataLength(data);

    return {
      fileName: capture.fileName,
      targetId: target.id ?? 'unclassified',
      targetName: target.name ?? '',
      method: meta.method ?? '',
      url: meta.url ?? '',
      path: getPath(meta.url),
      requestKeys: Object.keys(meta.requestBodyJson ?? {}),
      dataKind: getDataKind(data),
      dataLength,
      looksLike96Point: looksLike96PointData(
        data,
        sampleDataKeys,
        pointColumnCount,
        dataLength
      ),
      pointColumnCount,
      sampleDataKeys,
    };
  });
}

export function formatInspectionMarkdown(rows) {
  const lines = [
    '# JSPEC response inspection',
    '',
    `Total inspected responses: ${rows.length}`,
    '',
    '| Target | Method | Endpoint | Shape | Request keys | Sample data keys | File |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const row of rows) {
    const shapeParts = [row.dataKind];
    if (row.dataLength !== null && row.dataLength !== undefined) {
      shapeParts.push(String(row.dataLength));
    }
    if (row.pointColumnCount) {
      shapeParts.push(`${row.pointColumnCount}-cols`);
    }
    if (row.looksLike96Point) {
      shapeParts.push('96-point');
    }

    lines.push(
      `| ${row.targetId} | ${row.method} | \`${row.path}\` | ${shapeParts.join(' / ')} | ${row.requestKeys.join(', ') || '-'} | ${row.sampleDataKeys.join(', ') || '-'} | \`${row.fileName}\` |`
    );
  }

  lines.push('');
  return lines.join('\n');
}
