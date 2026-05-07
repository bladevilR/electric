import {
  classifyBusinessTarget,
  listBusinessTargets,
  summarizeTargetCoverage,
} from './jspec-targets.mjs';

function increment(map, key, amount = 1) {
  if (!key) {
    return;
  }
  map[key] = (map[key] ?? 0) + amount;
}

export function buildCaptureSummary(captures) {
  const targetLookup = new Map(listBusinessTargets().map((target) => [target.id, target]));
  const byCategory = {};
  const byTarget = {};
  let classifiedCaptures = 0;

  for (const capture of captures) {
    const target =
      capture.businessTarget ??
      classifyBusinessTarget({
        url: capture.meta?.url ?? capture.request?.url ?? capture.url,
        requestHeaders:
          capture.meta?.requestHeaders ?? capture.request?.headers ?? capture.requestHeaders,
        pageUrl: capture.pageUrl,
      });
    if (!target?.id) {
      continue;
    }
    classifiedCaptures += 1;

    const knownTarget = targetLookup.get(target.id) ?? target;
    increment(byCategory, knownTarget.category);

    if (!byTarget[target.id]) {
      byTarget[target.id] = {
        id: target.id,
        name: knownTarget.name ?? target.name,
        category: knownTarget.category ?? target.category,
        priority: knownTarget.priority ?? target.priority,
        required: Boolean(knownTarget.required ?? target.required),
        outputHint: knownTarget.outputHint ?? target.outputHint,
        count: 0,
      };
    }
    byTarget[target.id].count += 1;
  }

  return {
    totalCaptures: captures.length,
    classifiedCaptures,
    byCategory,
    byTarget,
    targetCoverage: summarizeTargetCoverage(captures),
  };
}

export function formatCoverageMarkdown(summary) {
  const targets = listBusinessTargets();
  const byTarget = summary.byTarget ?? {};
  const lines = [
    '# JSPEC capture coverage',
    '',
    `Total captures: ${summary.totalCaptures}`,
    `Classified captures: ${summary.classifiedCaptures}`,
    '',
    '## Present',
    '',
  ];

  const present = Object.values(byTarget).sort((a, b) => a.id.localeCompare(b.id));
  if (present.length === 0) {
    lines.push('- None yet');
  } else {
    for (const target of present) {
      lines.push(
        `- ${target.priority} ${target.name}: ${target.count} response(s), ${target.outputHint}`
      );
    }
  }

  const missingRequired = targets.filter((target) =>
    summary.targetCoverage.missingRequiredIds.includes(target.id)
  );
  lines.push('', '## Missing P0', '');
  if (missingRequired.length === 0) {
    lines.push('- None');
  } else {
    for (const target of missingRequired) {
      lines.push(`- ${target.name}: open \`${target.routeFragments[0]}\``);
    }
  }

  const missingOptional = targets.filter((target) =>
    summary.targetCoverage.missingOptionalIds.includes(target.id)
  );
  lines.push('', '## Missing Optional', '');
  if (missingOptional.length === 0) {
    lines.push('- None');
  } else {
    for (const target of missingOptional) {
      lines.push(`- ${target.priority} ${target.name}: \`${target.routeFragments[0]}\``);
    }
  }

  lines.push('');
  return lines.join('\n');
}
