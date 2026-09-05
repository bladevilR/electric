const STAGES = [
  ['evidence', '时点证据'],
  ['load', '负荷预测'],
  ['price', '价格分布'],
  ['supplyNetwork', '供给与网络'],
  ['positionLimits', '持仓与限额'],
  ['objectiveConstraints', '目标与硬约束'],
  ['recommendation', '推荐申报'],
];

const unique = (values = []) => [
  ...new Set(values.filter((value) => value !== null && value !== undefined && value !== '')),
];

const FIELD_GROUPS = {
  load: /load|temperature|weather|humidity|dewpoint|feelslike|cloud|precipitation/i,
  price: /price/i,
  supplyNetwork:
    /capacity|section|congestion|outage|reserve|output|interchange|generation|mustrun|muststop|ramp/i,
  positionLimits:
    /position|availablebuy|availablesell|adjustablebuy|adjustablesell|tradelimit|traded|declaredpower(?:upper|lower)/i,
  objectiveConstraints:
    /availablebuy|availablesell|adjustablebuy|adjustablesell|tradelimit|declaredpower(?:upper|lower)|defaultdeclaredpower(?:upper|lower)/i,
};

function parseTime(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function factIsEligible(fact, input) {
  if (!fact?.factId || fact.businessDate !== input.targetDate) return false;
  if (input.pointIndex && Number(fact.pointIndex) !== Number(input.pointIndex)) return false;
  const cutoff = parseTime(input.asOf);
  const availableAt = parseTime(fact.availableAt);
  return cutoff !== null && availableAt !== null && availableAt <= cutoff;
}

function runIsEligible(run, input) {
  if (
    !run?.forecastRunId ||
    run.forecastRunType !== 'live_issued' ||
    run.targetTradingDate !== input.targetDate
  ) {
    return false;
  }
  if (
    input.pointIndex &&
    Array.isArray(run.rows) &&
    !run.rows.some((row) => Number(row.pointIndex) === Number(input.pointIndex))
  ) {
    return false;
  }
  const cutoff = parseTime(input.asOf);
  const issuedAt = parseTime(run.forecastGeneratedAt || run.issuedAt || run.createdAt);
  return cutoff !== null && issuedAt !== null && issuedAt <= cutoff;
}

function stageFromEvidence(facts, runs, summary) {
  const inputRefs = unique(facts.map((fact) => fact.factId));
  const forecastRunIds = unique(runs.map((run) => run.forecastRunId));
  const modelVersions = unique(runs.map((run) => run.modelVersion || run.modelId));
  const featureSnapshotIds = unique(runs.map((run) => run.featureSnapshotId));
  if (!inputRefs.length && !forecastRunIds.length) return null;
  return {
    summary,
    inputRefs,
    forecastRunIds,
    modelVersions,
    featureSnapshotId: featureSnapshotIds.at(-1) || null,
    ...(featureSnapshotIds.length > 1
      ? { warnings: [`multiple_feature_snapshots:${featureSnapshotIds.join(',')}`] }
      : {}),
  };
}

function derivedStageEvidence(input) {
  const facts = (Array.isArray(input.facts) ? input.facts : []).filter((fact) =>
    factIsEligible(fact, input)
  );
  const runs = (Array.isArray(input.forecastRuns) ? input.forecastRuns : [])
    .filter((run) => runIsEligible(run, input))
    .sort(
      (left, right) =>
        parseTime(left.forecastGeneratedAt || left.issuedAt || left.createdAt) -
        parseTime(right.forecastGeneratedAt || right.issuedAt || right.createdAt)
    );
  const factsFor = (pattern) => facts.filter((fact) => pattern.test(String(fact.fieldId || '')));
  const runsFor = (pattern) => runs.filter((run) => pattern.test(String(run.targetField || '')));
  const constraintFacts = factsFor(FIELD_GROUPS.objectiveConstraints);

  return {
    evidence: stageFromEvidence(facts, runs, '已按决策截止时间筛选真实事实与正式发布预测'),
    load: stageFromEvidence(
      factsFor(FIELD_GROUPS.load),
      runsFor(FIELD_GROUPS.load),
      '负荷及气象驱动证据已形成'
    ),
    price: stageFromEvidence(
      factsFor(FIELD_GROUPS.price),
      runsFor(FIELD_GROUPS.price),
      '价格事实与正式发布预测已形成'
    ),
    supplyNetwork: stageFromEvidence(
      factsFor(FIELD_GROUPS.supplyNetwork),
      runsFor(FIELD_GROUPS.supplyNetwork),
      '供给与网络证据已形成'
    ),
    positionLimits: (() => {
      const stage = stageFromEvidence(
        factsFor(FIELD_GROUPS.positionLimits),
        [],
        '持仓与交易限额事实已形成'
      );
      return stage ? { ...stage, constraintRefs: unique(stage.inputRefs) } : null;
    })(),
    objectiveConstraints: (() => {
      const stage = stageFromEvidence(constraintFacts, [], '硬约束事实已形成');
      return stage ? { ...stage, constraintRefs: unique(stage.inputRefs) } : null;
    })(),
  };
}

function hasSubstantiveEvidence(data) {
  if (!data || typeof data !== 'object') return false;
  return Boolean(
    (Array.isArray(data.inputRefs) && data.inputRefs.length) ||
      data.featureSnapshotId ||
      (Array.isArray(data.forecastRunIds) && data.forecastRunIds.length) ||
      (Array.isArray(data.modelVersions) && data.modelVersions.length) ||
      (Array.isArray(data.constraintRefs) && data.constraintRefs.length) ||
      (data.inputs && typeof data.inputs === 'object' && Object.keys(data.inputs).length)
  );
}

export function buildStrategyTrace(input = {}) {
  const derived = derivedStageEvidence(input);
  const stages = STAGES.map(([id, title]) => {
    const data = input[id] || derived[id] || null;
    const supported = hasSubstantiveEvidence(data);
    const missingFields =
      Array.isArray(data?.missingFields) && data.missingFields.length
        ? data.missingFields
        : id === 'supplyNetwork' && !supported
          ? ['availableCapacityMw', 'sectionUtilizationPct']
          : [];
    const status = supported
      ? data?.status === 'degraded' || missingFields.length
        ? 'degraded'
        : 'available'
      : missingFields.length
        ? 'degraded'
        : 'unavailable';
    return {
      id,
      title,
      status,
      data: supported ? data : null,
      inputs: supported ? data.inputs || {} : {},
      missingFields,
      conclusion: {
        conclusionId: supported
          ? data.conclusionId || `${input.targetDate || 'unknown'}:${input.pointIndex || 'all'}:${id}`
          : null,
        summary: supported ? data.summary || '节点证据已形成' : '证据不足',
        status: supported && status === 'available' ? 'supported' : 'degraded',
        inputRefs: supported ? unique(data.inputRefs || []) : [],
        featureSnapshotId: supported ? data.featureSnapshotId || null : null,
        forecastRunIds: supported ? unique(data.forecastRunIds || []) : [],
        modelVersions: supported ? unique(data.modelVersions || []) : [],
        formulaVersion: supported ? data.formulaVersion || null : null,
        constraintRefs: supported ? unique(data.constraintRefs || []) : [],
        warnings: supported ? unique(data.warnings || []) : ['source_evidence_missing'],
      },
    };
  });
  return {
    targetDate: input.targetDate || null,
    pointIndex: input.pointIndex || null,
    asOf: parseTime(input.asOf) === null ? null : input.asOf,
    stages,
    baselineRecommendationAllowed: stages.find((stage) => stage.id === 'load').status === 'available',
    executionAllowed: false,
    humanReviewRequired: true,
  };
}
