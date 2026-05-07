export function pickHeaderValue(headers = [], name) {
  const match = headers.find(
    (header) => String(header?.name || '').toLowerCase() === String(name).toLowerCase()
  );
  return match?.value;
}

export function buildReplayRequest(entry) {
  const url = entry?.request?.url ?? '';
  const method = entry?.request?.method ?? 'GET';
  const resourceType = entry?._resourceType ?? entry?._initiator?.type ?? '';

  const requestHeaders = entry?.request?.headers ?? [];
  const allowedHeaders = [
    'accept',
    'accept-language',
    'clienttag',
    'content-type',
    'currentroute',
    'origin',
    'referer',
    'x-ticket',
    'x-token',
  ];

  const headers = {};
  for (const header of requestHeaders) {
    const lowerName = String(header?.name || '').toLowerCase();
    if (!allowedHeaders.includes(lowerName)) {
      continue;
    }

    headers[header.name] = header.value;
  }

  return {
    url,
    method,
    resourceType,
    headers,
    bodyText: entry?.request?.postData?.text ?? '',
  };
}

export function shouldReplayRequest(entry) {
  const request = buildReplayRequest(entry);
  if (!request.url.startsWith('https://www.jspec.com.cn/')) {
    return false;
  }

  if (!['xhr', 'fetch'].includes(request.resourceType)) {
    return false;
  }

  if (!request.headers['X-Ticket']) {
    return false;
  }

  return true;
}
