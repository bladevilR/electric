const sum=(rows,key)=>rows.reduce((total,row)=>total+Number(row[key]),0);
export function replaySettlementEconomics({forecastRun,strategyTrace,settlementFacts=[],tariffVersion}={}){
  const warnings=[];if(!forecastRun?.targetTradingDate)warnings.push('target_date_missing');if(!tariffVersion)warnings.push('tariff_version_missing');if(!(strategyTrace?.rows||[]).some(row=>row.executed))warnings.push('executed_strategy_missing');
  const facts=settlementFacts.filter(row=>row.businessDate===forecastRun?.targetTradingDate&&row.actualLabelVersion==='settlement_final');
  if(!facts.length)warnings.push('final_settlement_missing');
  const keys=['baselineCostYuan','strategyCostYuan','actualOperatorCostYuan','perfectInformationLowerBoundYuan'];for(const key of keys)if(facts.length&&!facts.every(row=>Number.isFinite(Number(row[key]))))warnings.push(`${key}_missing`);
  if(warnings.length)return{status:'insufficient_settlement_evidence',baselineCostYuan:null,strategyCostYuan:null,actualOperatorCostYuan:null,perfectInformationLowerBoundYuan:null,savingVsDefaultYuan:null,economicRegretYuan:null,warnings};
  const baselineCostYuan=sum(facts,'baselineCostYuan'),strategyCostYuan=sum(facts,'strategyCostYuan'),actualOperatorCostYuan=sum(facts,'actualOperatorCostYuan'),perfectInformationLowerBoundYuan=sum(facts,'perfectInformationLowerBoundYuan');
  return{status:'ready',baselineCostYuan,strategyCostYuan,actualOperatorCostYuan,perfectInformationLowerBoundYuan,savingVsDefaultYuan:baselineCostYuan-strategyCostYuan,economicRegretYuan:strategyCostYuan-perfectInformationLowerBoundYuan,warnings:[]};
}
