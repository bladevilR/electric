const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;

export function createReviewController({fetchReport,onState}) {
  let sequence=0;
  let state={selection:null,report:null,loading:false,error:''};
  return {
    async select(input) {
      const ticket=++sequence;
      const date=input.date || state.selection?.date;
      const type=input.type || state.selection?.type || 'price';
      if(!validDate(date)||!['price','temperature','load'].includes(type)) return;
      const selection={date,month:date.slice(0,7),type};
      const cached=state.report?.month===selection.month && state.report.type===type ? state.report : null;
      const selected=cached?.days.find(day=>day.date===date);
      state={selection,report:selected?{...cached,targetDate:date,selected}:null,loading:true,error:''};
      onState(state);
      try {
        const report=await fetchReport(selection);
        if(ticket!==sequence) return;
        if(report.targetDate!==date || report.selected?.date!==date || report.type!==type || report.month!==selection.month) throw new Error('返回结果与所选日期不一致，请重新加载。');
        state={selection,report,loading:false,error:''};
      } catch(error) {
        if(ticket!==sequence) return;
        state={selection,report:null,loading:false,error:error.message || '该日期加载失败，请重试。'};
      }
      onState(state);
    },
  };
}
