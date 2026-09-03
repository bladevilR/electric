const esc = (value) =>
  String(value ?? '—').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]
  );

export function renderExplanationButton(id, label) {
  return `<button type="button" class="foundation-info-button" data-foundation-action="open-explanation" data-explanation-id="${esc(
    id
  )}" aria-label="${esc(label)}：查看公式与依据" aria-controls="foundationEvidenceDrawer" aria-expanded="false"><span aria-hidden="true">查看公式</span></button>`;
}

export function renderFoundationTooltip(explanation = {}) {
  if (!explanation.id) return '';
  return `
    <aside class="foundation-tooltip" role="note" aria-label="${esc(explanation.title)}">
      <strong>${esc(explanation.title)}</strong>
      <p>${esc(explanation.principle)}</p>
      <code>${esc(explanation.formula)}</code>
      <small>${esc(explanation.caveat)}</small>
    </aside>
  `;
}

function evidenceValue(value) {
  return value ? esc(value) : '尚无可用证据';
}

export function renderFoundationEvidenceDrawer(explanation = {}, evidence = {}) {
  if (!explanation.id) return '';
  return `
    <aside class="foundation-evidence-drawer" id="foundationEvidenceDrawer" role="dialog" aria-modal="false" aria-labelledby="foundationEvidenceTitle" tabindex="-1">
      <header>
        <div>
          <small>CONTEXTUAL EVIDENCE</small>
          <h2 id="foundationEvidenceTitle">${esc(explanation.title)}</h2>
        </div>
        <button type="button" data-foundation-action="close-explanation" aria-label="关闭依据说明">关闭</button>
      </header>
      <section><h3>原理</h3><p>${esc(explanation.principle)}</p></section>
      <section><h3>核心公式</h3><code class="foundation-formula">${esc(
        explanation.formula
      )}</code><p>${esc(explanation.caveat)}</p></section>
      ${
        explanation.variables?.length
          ? `<section><h3>变量与单位</h3><dl class="foundation-variable-list">${explanation.variables
              .map(
                (variable) =>
                  `<div><dt>${esc(variable.name)}</dt><dd>${esc(variable.meaning)} · ${esc(
                    variable.unit
                  )}</dd></div>`
              )
              .join('')}</dl></section>`
          : ''
      }
      <section>
        <h3>本次使用</h3>
        <dl class="foundation-evidence-list">
          <div><dt>数据截止</dt><dd>${evidenceValue(evidence.dataCutoff)}</dd></div>
          <div><dt>模型版本</dt><dd>${evidenceValue(evidence.modelVersion)}</dd></div>
          <div><dt>约束版本</dt><dd>${evidenceValue(evidence.constraintVersion)}</dd></div>
          <div><dt>入选事实</dt><dd>${evidenceValue(evidence.selectedFacts)}</dd></div>
        </dl>
      </section>
      <footer>
        <button type="button" class="foundation-secondary-button" data-foundation-action="open-provenance">查看完整推导</button>
        <button type="button" class="foundation-primary-button" data-foundation-action="close-explanation">关闭</button>
      </footer>
    </aside>
  `;
}

export function renderFoundationProvenance(open = false) {
  if (!open) {
    return `<button type="button" class="foundation-provenance-trigger" data-foundation-action="open-provenance" aria-expanded="false" aria-controls="foundationProvenance">数据血缘</button>`;
  }
  const stages = [
    ['JSPEC 页面', '实时价格与申报页面'],
    ['气象数据', '温度、湿度、风速、云量'],
    ['历史负荷', '同点位实际负荷与预测'],
    ['持仓与限额', '可交易边界与风险参数'],
    ['预测与特征', '时点快照、三类预测'],
    ['策略推演', '优化器与风险约束'],
    ['结果与复核', '解释、审批与回溯'],
  ];
  return `
    <aside class="foundation-provenance" id="foundationProvenance" aria-label="数据血缘">
      <header><strong>数据血缘</strong><button type="button" data-foundation-action="close-provenance">收起</button></header>
      <ol>${stages
        .map(([title, detail]) => `<li><strong>${title}</strong><small>${detail}</small></li>`)
        .join('')}</ol>
    </aside>
  `;
}
