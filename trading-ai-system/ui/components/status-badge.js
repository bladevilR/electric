const LABELS={confirmed_visible:'已在平台确认',confirmed_export:'已在报表确认',captured_nonempty:'已取得数据',code_supported:'尚未取得数据',captured_empty:'平台暂无记录',pending_field_confirmation:'含义待确认',pending_authorization:'需要授权',mock_only:'演示数据'};
export function renderStatusBadge(status){return `<span class="status-badge status-${status||'unknown'}">${LABELS[status]||'状态待确认'}</span>`;}
