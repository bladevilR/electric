// Translate at the display boundary; keep original identifiers in stored evidence.
export const escapeText = value => String(value ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const FIELDS = {
  actualAverageLoadMw:'实际用电功率', actualLoadMw:'实际用电功率',actualMwh:'实际用电量', actualKwh:'实际用电量', loadForecastMw:'预测用电功率',
  dayAheadUserPriceFinalYuanPerMwh:'日前最终电价', dayAheadUserPriceTempYuanPerMwh:'日前暂定电价',
  dayAheadUserClearedPowerMw:'日前成交功率', realTimeAvgPriceYuanPerMwh:'实时平均电价',
  realTimePriceYuanPerMwh:'实时电价', temperatureForecastC:'预报温度',temperatureActualC:'实际温度',temperatureC:'温度',
  humidityPct:'相对湿度',windSpeedMs:'风速',cloudCoverPct:'云量', loadMw:'用电功率',
  positionMw:'已持有电力',maxPowerMw:'申报功率上限',minPowerMw:'申报功率下限',
  buyLimitMw:'可买电量上限',sellLimitMw:'可卖电量上限',declaredPowerMw:'申报功率',
  realTimeSettlementPriceYuanPerMwh:'实时结算电价',
  settledLongTermEnergyMwh:'历史中长期合约结算电量',settledLongTermFeeYuan:'历史中长期合约结算电费',
  settledEnergyBlockMwh:'历史能量块结算电量',settledEnergyBlockFeeYuan:'历史能量块结算电费',
  settlementAmountYuan:'历史结算电费',settlementPriceYuanPerMwh:'历史结算单价',
  dayAheadUserPriceTemporaryYuanPerMwh:'日前暂定电价',realTimeAvgPrice:'实时平均电价',actualSystemLoadMw:'全省实际负荷',
};
export const fieldLabel = value => FIELDS[value] || (/^[\u3400-\u9fff\d（）()、 ·/℃%.-]+$/.test(String(value || '')) ? value : '其他数据（名称待确认）');
export const reportName = value => String(value || '').replace(/^LOCAL-LOAD:/,'').split(/[\\/]/).at(-1) || '导入的用电报表';
export function sourceLabel(value) {
  const id = String(value || '');
  if (id.startsWith('LOCAL-LOAD:')) return `用电报表 · ${reportName(id)}`;
  if (id.startsWith('OPEN-METEO')) return id.includes('ARCHIVE') ? 'Open-Meteo 历史天气' : 'Open-Meteo 天气预报';
  if (id.startsWith('SETTLEMENT-XLSX')) return '结算核对单';
  return {'JSPEC-DAYAHEAD-USER':'交易平台 · 日前电价','JSPEC-LOAD':'交易平台 · 用户用电数据','JSPEC-REALTIME-AVG':'交易平台 · 实时电价','JSPEC-REALTIME':'交易平台 · 实时电价'}[id] || '来源名称待确认';
}
export function methodLabel(value) {
  const id = String(value || '');
  if (/load/i.test(id)) return '参考历史相同时段的用电规律';
  if (/rolling_same_slot_median/.test(id)) return '历史同一时段的中间价格';
  if (/temperature|temp-forecast|open-meteo/i.test(id)) return '天气预报';
  if (/load|weekday|calendar/i.test(id)) return '参考历史相似日期的用电规律';
  if (/baseline|seasonal/i.test(id)) return '历史规律参考预测';
  if (/optimizer/i.test(id)) return '结合成本与限额生成建议';
  return id ? '预测方法待说明' : '尚无可用预测';
}
export function dateTime(value) {
  if (!value) return '暂无记录';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date).replaceAll('/','-') : '时间待确认';
}
export function slotTime(index) {
  const n = Number(index);
  if (!Number.isInteger(n) || n < 1 || n > 96) return '时段待确认';
  return `${String(Math.floor(n * 15 / 60)).padStart(2,'0')}:${String(n * 15 % 60).padStart(2,'0')}`;
}
export const unitLabel = unit => ({MW:'兆瓦（用电功率）',MWh:'兆瓦时（电量）',kWh:'千瓦时（度电）','元/MWh':'元/兆瓦时','℃':'℃','°C':'℃',C:'℃'}[unit] || plainText(unit));
export function statusLabel(value) {
  return {ready:'可用',passed:'检查通过',valid:'检查通过',available:'可用',complete:'已完成',completed:'已完成',blocked:'暂不可用',data_blocked:'数据尚未齐全',unavailable:'暂无数据',pending:'待确认',running:'正在更新',paused:'已暂停',rejected:'检查未通过',warning:'需要留意',champion:'当前采用',challenger:'待评估',baseline:'基础参考',actual:'实际结果',confirmed:'已确认',live_issued:'当时发布的预测',point_in_time_replay:'使用当时数据重新预测',settlement_replay:'结算后核对'}[value] || '待核实';
}
export function reasonLabel(code, fallback = '数据暂不可用，请稍后重试。') {
  if(code==='collection_failed') return '数据连接暂时中断，请重新连接交易平台后继续更新。';
  if(code==='limit_missing') return '交易限额尚未齐全。';
  if(code==='source_evidence_missing') return '来源记录尚未齐全。';
  return {service_unavailable:'交易平台用电数据服务维护中，更新已暂停；已有历史数据仍可查看。',operator_paused:'已手动暂停，继续后从上次位置开始。',collector_restarted:'服务重启后已暂停，已取得的数据保留。',login_required:'请在数据连接窗口登录交易平台。',login_expired:'交易平台登录已过期，请重新登录。',rate_limited:'平台访问较忙，系统会稍后重试。',collection_stalled:'数据更新暂时没有进展，已暂停以避免重复访问。',page_changed:'请在数据连接窗口打开交易平台的数据页面。',missing_required_field:'缺少必要数据，暂时不能使用。',empty_response:'平台未返回数据。',stale_history:'已有历史距离所选日期较远，暂不能可靠预测。'}[code] || FIELDS[code] || fallback;
}
export function plainText(value, fallback = '暂无说明') {
  if (value == null || value === '') return fallback;
  let s = String(value);
  s=s.replace(/MW\s*=\s*15分钟电量\(kWh\)\s*\/\s*1000\s*\/\s*0\.25/g,'每 15 分钟电量换算为平均用电功率')
    .replace(/MW\s*=\s*kWh\s*\/\s*1000\s*\/\s*0\.25/g,'每 15 分钟电量换算为平均用电功率');
  for (const [id,label] of Object.entries(FIELDS)) s = s.replaceAll(id,label);
  s = s.replace(/JSPEC(?:-[A-Z-]+)?/g,'交易平台').replace(/SQLite/g,'本地保存的数据')
    .replace(/数据血缘/g,'数据来源').replace(/规范化事实/g,'整理后的数据').replace(/特征快照/g,'本次使用的数据')
    .replace(/入库/g,'保存').replace(/同点位/g,'同一时段').replace(/点位/g,'时段').replace(/基线/g,'基础参考')
    .replace(/MAE/g,'平均误差').replace(/RMSE/g,'大误差参考').replace(/MAPE/g,'平均误差比例')
    .replace(/P10[–—\-\/]P90/g,'价格可能范围').replace(/P50/g,'中间预测值');
  // Raw paths, request diagnostics and unknown program symbols are not product copy.
  if (/[A-Za-z]:[\\/]|https?:\/\/|\/api\/|SHA-256|[a-f0-9]{32,}|\b[a-zA-Z][\w]*_[\w]+\b|\b[a-z]+[A-Z][A-Za-z0-9]+\b/.test(s)) return fallback;
  return s;
}

export const EXPLANATION_COPY = {
  sources:{title:'数据从哪里来',principle:'电价来自交易平台；天气可以使用天气预报；实际用电来自平台或导入报表。只有日期、单位和来源能核对的数据才会使用。',formula:'可用数据 = 来源明确 + 日期匹配 + 时段一致',caveat:'查到旧数据不代表当天数据齐全；具体可用范围以历史查询为准。'},
  quality:{title:'怎样判断数据能不能用',principle:'一天分为 96 个时段，每段 15 分钟。系统检查缺失、重复和单位，并确认作出预测时是否已经能获得这份数据。',formula:'完整程度 = 有数据的时段数 ÷ 96 × 100%',caveat:'即使一天数据齐全，也要检查是否过期；不能把后来才知道的实际结果用来冒充当时的预测。'},
  forecasts:{title:'价格、天气和用电怎样预测',principle:'三种预测分别展示，不把一种曲线当成另一种。价格参考历史同一时段，温度采用天气预报，用电参考历史相似日期；实际采用的方法以曲线旁说明为准。',formula:'预测与实际比较 = 同一天 + 同一时段 + 同一单位',caveat:'缺少可靠输入时保留空白；历史重新计算的结果会标明“事后回测”，不冒充当时发布的预测。'},
  fusion:{title:'怎样综合考虑这些影响',principle:'先把价格、天气、用电量和已有购电量对齐到同一天的各个时段，再分析哪些时段可能缺电、哪些时段成本较高。',formula:'需要补充的电量 = 预计用电量 − 已购电量',caveat:'这是形成策略的一般思路，不表示当前价格预测已经使用天气和负荷；缺少的数据不会自动补成真实值。'},
  mae:{title:'平均误差：通常差多少',principle:'逐个时段计算预测与实际相差多少，再取平均。单位与曲线一致，数值越小越好。',formula:'平均误差 = 各时段差值的绝对值之和 ÷ 比较时段数',caveat:'例如平均误差为 5 兆瓦，表示比较过的时段平均相差 5 兆瓦，不代表每个时段都只差 5。'},
  rmse:{title:'大误差参考：是否有明显预测偏差',principle:'先把误差平方，再求平均和平方根，较大的误差会更突出。数值越低越好。',formula:'大误差参考 = √（各时段误差平方之和 ÷ 比较时段数）',caveat:'如果明显高于平均误差，说明部分时段预测偏差较大，需要查看曲线。'},
  mape:{title:'平均误差比例：相对实际差多少',principle:'把每个时段的绝对误差除以实际值的绝对值，再计算平均百分比。',formula:'平均误差比例 = 平均（|预测 − 实际| ÷ |实际|）× 100%',caveat:'实际值为零或接近零时，这个比例不可靠，需要结合平均误差判断。'},
  baselineSkill:{title:'比简单参考预测好多少',principle:'在同样日期、相同时段上，比较当前方法与简单参考方法的误差，不能拿不同数据范围的结果直接比较。',formula:'改善比例 =（参考方法误差 − 当前方法误差）÷ 参考方法误差 × 100%',caveat:'正值表示误差减少，负值表示误差增加；没有同口径结果时不显示改善比例。'},
  optimizer:{title:'申报建议怎样计算',principle:'在满足用电需求的前提下，结合预测电价和已有购电量寻找成本更低的申报方案，同时控制偏差风险和相邻时段变化。',formula:'比较方案成本 = 预计购电费用 + 用电偏差带来的风险成本 + 调整过大的风险成本',caveat:'这是一种计算思路。实际建议还必须有可买卖量、功率限额等完整数据，经过人工确认才可采用。'},
  risk:{title:'哪些限制不能超过',principle:'检查申报功率是否在上下限内，以及相邻两个 15 分钟时段的变化是否超过业务允许范围。',formula:'申报功率必须在允许范围内；相邻时段的变化不能超过上限',caveat:'必要限额缺失时，不会把试算结果当成可执行策略。'},
  review:{title:'采用建议前需要确认什么',principle:'核对数据日期、预测偏差、购电量变化和业务限制，再由业务人员决定是否采用。',formula:'可以采用 = 数据齐全 + 限制检查通过 + 人工确认',caveat:'页面中的试调只用于比较效果，不会改变正式策略，也不会提交交易。'},
};
