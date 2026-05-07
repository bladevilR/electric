const TARGETS = [
  {
    id: 'user_bid_96',
    name: '用户侧96点主动申报',
    category: 'dayahead_declaration',
    priority: 'P0',
    required: true,
    routeFragments: ['/pxf-spotgoods-province-extranet/userBid96/index'],
    outputHint: '96点日前申报曲线',
  },
  {
    id: 'user_default_bid_96',
    name: '用户侧96点缺省申报',
    category: 'dayahead_declaration',
    priority: 'P0',
    required: true,
    routeFragments: ['/pxf-spotgoods-province-extranet/userDefaultBid96/index'],
    outputHint: '96点缺省申报曲线',
  },
  {
    id: 'dayahead_user_clearing',
    name: '用户侧日前出清',
    category: 'dayahead_price',
    priority: 'P0',
    required: true,
    routeFragments: [
      '/pxf-spotgoods-province-extranet/Dd2jyUserClearingResult/Dd2jyRqClearing',
    ],
    outputHint: '96点日前用户侧出清结果',
  },
  {
    id: 'dayahead_public_clearing',
    name: '日前出清结果公开',
    category: 'dayahead_price',
    priority: 'P0',
    required: true,
    routeFragments: [
      '/pxf-spotgoods-province-extranet/afterDiscloseInformation/xrdClearingResultOnlyJiesuan/DayClearingResult',
      '/pxf-spotgoods-province-extranet/provincialSpotMarketNewRule/RqClearingReleasePublic',
    ],
    outputHint: '96点日前公开出清价格',
  },
  {
    id: 'realtime_public_clearing',
    name: '实时出清结果公开',
    category: 'realtime_price',
    priority: 'P0',
    required: true,
    routeFragments: [
      '/pxf-spotgoods-province-extranet/afterDiscloseInformation/xrdClearingResultOnlyJiesuan/CurClearingResult',
      '/pxf-spotgoods-province-extranet/realTimeClearingRelease/RealTimeClearingReleasePublic',
    ],
    outputHint: '96点实时公开出清结果',
  },
  {
    id: 'realtime_average_price',
    name: '实时加权均价公开',
    category: 'realtime_price',
    priority: 'P0',
    required: true,
    routeFragments: [
      '/pxf-spotgoods-province-extranet/realTimeClearingRelease/RealTimeMarAvePricePublic',
    ],
    outputHint: '96点实时加权均价',
  },
  {
    id: 'actual_load_96',
    name: '96点日电量查询',
    category: 'actual_load',
    priority: 'P0',
    required: true,
    routeFragments: ['/pxf-js-outer-deferrableload/dayElectricity'],
    outputHint: '96点实际电量/负荷',
  },
  {
    id: 'settle_day',
    name: '日结算查询',
    category: 'settlement',
    priority: 'P0',
    required: true,
    routeFragments: ['/pxf-js-outer-deferrableload/settleDay'],
    outputHint: '日结算明细',
  },
  {
    id: 'settle_month',
    name: '月结算查询',
    category: 'settlement',
    priority: 'P1',
    required: false,
    routeFragments: ['/pxf-js-outer-deferrableload/settleMonth'],
    outputHint: '月结算明细',
  },
  {
    id: 'contract_monthly_energy',
    name: '合同分月电量展示',
    category: 'contract_position',
    priority: 'P1',
    required: false,
    routeFragments: ['/pxf-js-outer-planmod/contractMonthlyEng'],
    outputHint: '合同分月计划和剩余量',
  },
  {
    id: 'position_query',
    name: '持仓量查询',
    category: 'contract_position',
    priority: 'P1',
    required: false,
    routeFragments: ['/pxf-js-outer-planmod/fsjyccl'],
    outputHint: '当前持仓量',
  },
  {
    id: 'current_contract',
    name: '当前合同',
    category: 'contract_position',
    priority: 'P1',
    required: false,
    routeFragments: ['/pxf-contract-extranet/contract/currentContract'],
    outputHint: '当前合同台账',
  },
  {
    id: 'history_contract',
    name: '历史合同',
    category: 'contract_position',
    priority: 'P1',
    required: false,
    routeFragments: ['/pxf-contract-extranet/contract/historyContract'],
    outputHint: '历史合同台账',
  },
  {
    id: 'spot_statement_dispute',
    name: '现货结算单及争议',
    category: 'settlement',
    priority: 'P1',
    required: false,
    routeFragments: ['/pxf-js-outer-settlespot/rptApproveInfo/rptApproveInfo'],
    outputHint: '现货结算单',
  },
  {
    id: 'statement_confirm',
    name: '结算单查询',
    category: 'settlement',
    priority: 'P1',
    required: false,
    routeFragments: ['/pxf-settlement-extnet/statementConfirm'],
    outputHint: '结算单确认数据',
  },
  {
    id: 'user_time_energy',
    name: '用户分时电量查询',
    category: 'actual_load',
    priority: 'P1',
    required: false,
    routeFragments: ['/pxf-js-outer-settlespot/sellerUserEnergyInfo/UserInfo'],
    outputHint: '用户分时电量',
  },
  {
    id: 'short_system_load_forecast',
    name: '短期系统负荷预测',
    category: 'market_context',
    priority: 'P2',
    required: false,
    routeFragments: [
      '/pxf-spotgoods-province-extranet/spotUnitShortSystemLoadForecast/index',
    ],
    outputHint: '系统负荷预测上下文',
  },
  {
    id: 'actual_system_load',
    name: '实际系统负荷',
    category: 'market_context',
    priority: 'P2',
    required: false,
    routeFragments: [
      '/pxf-spotgoods-province-extranet/afterDiscloseInformation/actualPowerGridOperation/ActualSystemLoad',
    ],
    outputHint: '系统实际负荷上下文',
  },
  {
    id: 'file_download_center',
    name: '数据下载中心',
    category: 'download',
    priority: 'P2',
    required: false,
    routeFragments: ['/pxf-js-outer-settlecal/fileDownCenter'],
    outputHint: '平台批量文件下载入口',
  },
];

function normalizeForMatch(value) {
  return String(value ?? '').trim().toLowerCase();
}

function getHeader(headers, name) {
  const target = normalizeForMatch(name);
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (normalizeForMatch(key) === target) {
      return value;
    }
  }
  return undefined;
}

function getMatchText({ url, requestHeaders = {}, pageUrl = '' }) {
  const currentRoute = getHeader(requestHeaders, 'CurrentRoute');
  const referer = getHeader(requestHeaders, 'Referer');
  return [url, pageUrl, currentRoute, referer].filter(Boolean).join('\n').toLowerCase();
}

export function listBusinessTargets() {
  return TARGETS.map((target) => ({ ...target, routeFragments: [...target.routeFragments] }));
}

export function classifyBusinessTarget({ url, requestHeaders, pageUrl } = {}) {
  const matchText = getMatchText({ url, requestHeaders, pageUrl });

  if (!matchText) {
    return null;
  }

  const target = TARGETS.find((item) =>
    item.routeFragments.some((fragment) => matchText.includes(fragment.toLowerCase()))
  );

  if (!target) {
    return null;
  }

  return {
    id: target.id,
    name: target.name,
    category: target.category,
    priority: target.priority,
    required: target.required,
    outputHint: target.outputHint,
  };
}

export function summarizeTargetCoverage(captures) {
  const presentIds = new Set(
    captures
      .map((capture) => capture.businessTarget?.id)
      .filter((value) => typeof value === 'string' && value)
  );

  const requiredTargets = TARGETS.filter((target) => target.required);
  const optionalTargets = TARGETS.filter((target) => !target.required);

  return {
    presentRequiredIds: requiredTargets
      .filter((target) => presentIds.has(target.id))
      .map((target) => target.id),
    missingRequiredIds: requiredTargets
      .filter((target) => !presentIds.has(target.id))
      .map((target) => target.id),
    presentOptionalIds: optionalTargets
      .filter((target) => presentIds.has(target.id))
      .map((target) => target.id),
    missingOptionalIds: optionalTargets
      .filter((target) => !presentIds.has(target.id))
      .map((target) => target.id),
    targetCount: TARGETS.length,
    requiredCount: requiredTargets.length,
  };
}
