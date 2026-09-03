const LABELS={confirmed_visible:'页面已确认',confirmed_export:'导出已确认',captured_nonempty:'已采集非空实值',code_supported:'代码已支持，尚无非空实值',captured_empty:'已采集但为空',pending_field_confirmation:'待字段确认',pending_authorization:'待授权',mock_only:'仅模拟'};
export function renderStatusBadge(status){return `<span class="status-badge status-${status||'unknown'}">${LABELS[status]||'状态待确认'}</span>`;}
