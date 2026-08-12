from __future__ import annotations

import hashlib
import os
import tempfile
import uuid
import zipfile
from pathlib import Path

from lxml import etree


W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"w": W}
QN = lambda tag: f"{{{W}}}{tag}"


SOURCE = Path("/Users/r/Downloads/第二届综合交通运输大模型智能体创新应用大赛提交作品情况表.docx")
OUTPUT = Path("/Users/r/Downloads/第二届综合交通运输大模型智能体创新应用大赛提交作品情况表_已填写.docx")
EXPECTED_SHA256 = "a60e269ea672e7091e743c21bda48874e81bc552ea056c9c4adbaf7899b04725"
EMBED_FONT_PATH = Path("/Library/Fonts/Arial Unicode.ttf")
EMBED_FONT_NAME = "Arial"
EMBED_FONT_PACKAGE_PATH = "word/fonts/font2.odttf"
EMBED_FONT_KEY = uuid.UUID("8CDFFFCD-1DC0-4746-ACF2-7CBF96917B8C")


CONTENT = {
    0: ["苏州地铁电力交易 AI 辅助策略系统"],
    1: [
        "□基础设施全生命周期数智化升级",
        "□综合交通枢纽协同运行智能化",
        "□新型载运装备智能化",
        "□智慧出行服务",
        "□交通运行调度与协同处置",
        "□智慧物流与供应链协同优化",
        "□智能化安全监管",
        "□政务服务与行政管理",
        "□具身智能研发与应用",
        "☑开放创新与特色场景应用",
        "（以上已勾选一项）",
    ],
    2: [
        "□公路     □铁路     □水运     □民航",
        "□邮政     ☑城市     □综合交通",
        "（以上已勾选一项）",
    ],
    3: ["□是   ☑否"],
    4: ["苏州市轨道交通集团有限公司"],
    5: ["无"],
    6: [
        "本作品面向城市轨道交通大体量购电与现货申报场景，服务电力交易、能源管理和审核人员。现有工作分散在交易平台、结算表和人工台账，存在数据口径不一、96点负荷与价格难联动、申报依赖经验、建议缺少验证和审计证据等痛点。作品在不改变UKey和人工提交边界的前提下，构建“接入—校验—验证—优化—复核—结算评估”闭环，通过降低申报偏差和人工核对投入实现降本增效。",
        "系统依赖江苏电力交易平台合规可见数据、历史申报与实际负荷、结算核对表及业务规则，可在普通Windows电脑本地运行；实时采集需UKey、CA驱动和授权账号。技术采用时序特征库、走步回测、冠军—挑战者模型、规则引擎、申报优化器、内网本地部署DeepSeek、审计日志和可视化工作台。DeepSeek负责语义理解和结果说明，数值预测、校验及门禁由可复现算法完成。",
        "智能体覆盖交易日数据准备、96点完整性检查、负荷与价格基线预测、历史回放、申报建议、风险提示、复核材料导出和操作留痕。独立留出集覆盖43个完整交易日、4,128个点，优化模型相对默认申报的MAE改善9.64%，交易日胜率86.05%。指标反映申报偏差改善和偏差费用降本潜力，不属于价格炒作或投机收益；实际降本金额须待价格、手续费、偏差费用和结算结果形成证据闭环后核算。作品可推广至地铁、公交枢纽、机场等高耗能交通主体。详见附件2作品演示视频。",
    ],
    7: [
        "已构建交通用能多源时序数据集与证据索引。数据来自江苏电力交易平台授权可见页面及下载文件、历史申报与实际负荷、结算核对表和业务配置；统一清洗为“交易日—15分钟点位”96点结构，并记录来源文件、字段口径、单位、时间戳、完整度和数据版本。核心历史回放集覆盖214个完整交易日、20,544个可比点；独立留出集覆盖43日、4,128点。",
        "标注主要由业务规则和可核验事实自动生成，包括数据缺失、单位异常、时间新鲜度、基线/建议/实际值、模型胜负和回退原因，不采集或伪造人工思维链。数据与能力映射为：价格与负荷序列支撑预测，申报与实际负荷支撑偏差回放，结算字段支撑成本核算，规则与案例支撑风险解释。训练、验证、留出集严格按时间顺序划分，每日预测只使用此前数据，防止未来信息泄漏。",
    ],
    8: [
        "系统采用“内网DeepSeek大模型＋专业时序模型＋规则/优化引擎”的混合架构。内网本地部署的DeepSeek用于理解自然语言意图、压缩证据和生成中文分析说明，低温度运行并受系统提示约束，不参与自动下单、价格投机或市场炒作。专业模型包括同点位朴素基线、滚动中位数和42日同点位实际负荷均值等轻量时序模型；申报优化器按96个点位输出建议，并由交易限额、非负值、数据完整性和新鲜度规则校验。",
        "模型评估采用严格时间顺序的60%/20%/20%切分：训练段形成特征，验证段选择窗口和权重，最终留出集只负责晋级判定。运行采用冠军—挑战者、影子验证和自动回退机制，挑战者须同时满足样本量、MAE改善率和交易日胜率门槛才能替代默认基线；样本不足、模型失败或数据过期即回退。当前不做端到端微调，确保结论可解释、算力可控并可在普通办公电脑部署。",
    ],
    9: [
        "智能体感知用户文本指令，以及CSV、JSON、电子表格和交易平台页面中的价格、申报、负荷、结算等结构化数据；按交易日和96个15分钟点位识别时间环境。它同步感知UKey/登录状态、数据完整度与新鲜度、模型验证状态、交易限额、当前演示或生产场景，并把缺失字段、异常单位和回退点转换为可操作的环境状态。",
    ],
    10: [
        "智能体先把用户意图归类为数据采集、质量校验、预测验证、申报优化、人工复核或报告导出，再结合交易日、96点覆盖率、数据版本和权限状态构建任务上下文。认知层不依赖单一大模型：业务规则判断字段是否齐备、单位是否一致、数据是否过期；时序模型评估负荷/申报偏差；优化器在非负值、交易限额和晋级门槛下生成候选建议；大模型仅把结构化证据转换为易读解释。",
        "系统使用因果门禁避免错误外推：缺少目标日完整默认申报时不生成整日建议；历史样本不足的点位自动回退基线；实际负荷超过48小时未更新时阻止目标日优化；留出集未达门槛时挑战者不得晋级；价格、手续费和偏差费用未对齐时不计算人民币降本金额。信息不足时不猜测数字，而是返回“缺少什么—影响什么—如何补齐—补齐后重跑”的恢复路径，并保留可继续复核的默认基线。",
    ],
    11: [
        "执行层把任务编排为可审计步骤：读取本地与平台授权数据，解析并标准化为96点特征，执行质量校验和数据版本登记，调用回测引擎比较基线与挑战者，调用申报优化器生成逐点建议，再形成图表、策略报告和人工复核草稿。外部工具包括UKey数据助手、Excel/CSV解析器、内网DeepSeek推理服务、报告导出器和本地审计日志；所有调用均有状态、超时和错误摘要。",
        "界面持续展示数据准备、AI建模、建议生成、人工复核和外部提交五阶段进度。实时采集必须由授权人员打开数据窗口并登录，系统不会读取Cookie、Token、证书私钥或UKey PIN。异常时按影响范围处理：模型接口不可用则保留确定性分析；挑战模型不合格则回退默认申报；单点历史不足则仅回退该点；整日数据不完整则阻止可执行建议并给出恢复步骤。任何交易草稿都标记为“需人工决定、禁止自动提交”，高风险动作转交授权人员复核。",
    ],
    12: [
        "系统以交易日为会话主键保持多轮上下文，关联当前数据版本、96点覆盖、模型选择、回退原因、人工决定和报告状态；追加式审计日志记录事件时间、操作者、结果和证据摘要。非敏感的日期、视图与模型配置可本地复用，但不记忆登录态、Cookie、Token、证书或UKey PIN。学习采用受控的冠军—挑战者机制：新窗口、权重或模型先在历史验证集和独立留出集评估，达到门槛后方可晋级；失败经验沉淀为规则和回退原因，可迁移到其他交通主体的同类96点用能任务。",
    ],
    13: [
        "系统坚持“辅助决策、不自动交易”。权限边界以授权账号、UKey和人工确认为准，不绕过CA认证，不读取浏览器会话、Cookie、Token、证书私钥或PIN；模型密钥只从受控环境配置读取，错误信息自动遮蔽敏感片段。数据默认在本地处理，生产数据与演示样本明确隔离，演示页面持续标注“本地演示”，防止误认真实运行结果。",
        "风险控制覆盖输入、模型、输出和执行四层：输入层校验来源、完整度、单位、日期和新鲜度；模型层采用时间隔离验证、晋级门槛、无泄漏检查和自动回退；输出层禁止在成本证据不完整时宣称人民币降本金额，禁止生成越权下单指令；执行层只生成可编辑复核草稿，提交动作始终在外部交易平台由授权人员完成。数据版本、模型选择、回退、人工决定和导出均写入追加式审计日志，可追溯至原始证据。异常时系统宁可阻断或回退，也不以静默降级冒充成功。",
    ],
    14: [
        "96点清洗、回测、优化和规则判断均在本地确定性执行，不消耗大模型Token。大模型只处理压缩后的价格统计、完整度、候选建议和风险摘要，单次输出上限900 Token、温度0.2，接口返回usage便于计量；最多传入6条候选建议。模型未配置、超时或报错时直接回退本地分析，不影响基线复核，以较低Token成本换取可解释性和稳定性。",
    ],
    15: [
        "系统由七个协同模块组成。①数据接入与证据索引：读取交易平台授权可见表格、历史Excel/CSV和本地业务配置，登记来源、版本与字段口径；实时数据助手在用户登录后执行可见页面的全量慢采。②质量校验与特征库：把价格、申报、负荷、结算统一为交易日96点结构，检查缺失、重复、单位、日期、新鲜度和完整交易日，形成可追溯特征。",
        "③预测与模型验证：对价格、负荷和申报偏差运行基线及候选模型，采用走步回测和时间隔离留出集比较MAE、点位胜率、交易日胜率与样本覆盖；只有达门槛的挑战者才能晋级。④申报优化：以完整默认申报为冠军基线，按每个15分钟点位读取历史实际负荷，应用已验证的42日同点位模型生成建议；单点样本不足、输入过期或限额异常时自动回退，并明确覆盖率和原因。",
        "⑤智能解释与风险问答：内网本地部署的DeepSeek只接收压缩后的结构化证据，输出价格窗口、数据缺口和人工确认边界；模型未启用时仍提供规则化结论。⑥人工复核工作台：展示四项验证证据、基线/AI建议96点曲线、上调/下调窗口、回退点和风险提示；支持生成可编辑交易草稿，但数量、限价及提交均须授权人员确认。⑦报告与审计：导出策略报告、验证结果和复核材料，记录数据版本、模型选择、建议生成、回退、人工决定和操作时间。",
        "模块输入为授权数据、交易日和业务限制，输出为数据质量状态、模型验证报告、逐点建议、阻塞原因、复核草稿和审计记录。主流程按“接入—校验—验证—优化—复核—结算评估”串联；缺少成本字段时只报告偏差改善，结算后再用统一口径核算实际降本金额。详见附件2作品演示视频。",
    ],
    16: [
        "作品的核心业务价值是降本，而不是炒作价格或赚取投机收益。系统把分散在平台、Excel和人工经验中的流程收敛为统一证据链，减少人工找数、口径核对和重复计算投入，并通过优化申报偏差降低偏差费用风险。独立留出集显示，已验证模型相对默认申报的MAE改善9.64%，43个交易日中86.05%的日期优于基线。系统仅辅助采购决策和人工复核，不自动交易；待结算价格、手续费、偏差费用和运行成本齐备后，再按统一公式核算可归因的实际降本金额。",
    ],
    17: [
        "系统采用本地化、模块化和可替换接口，普通Windows电脑即可运行；数据、模型、规则、界面和审计相互解耦，便于低成本维护。日常通过数据完整度、新鲜度、模型漂移和接口状态监控运行；新增数据持续进入影子验证，只有通过独立留出集门槛才晋级。自动化测试、版本化配置、日志和回退基线保证升级可追溯，行业规则变化可通过规则与字段映射增量适配。",
    ],
    18: [
        "核心能力建立在“交通主体用能数据—统一时序特征—验证门禁—人工复核”通用框架上，可复用于地铁、公交场站、铁路枢纽、机场、港口等高耗能场景。迁移时主要配置数据字段映射、交易规则、计量周期和权限边界，无须重建整套系统；轻量模型和本地部署降低算力、网络与改造成本。通过冠军—挑战者和默认基线兜底，可先影子运行、再逐步上线，具备规模化复制条件。",
    ],
    19: [
        "本表所列9.64%改善率、86.05%交易日胜率及43日/4,128点覆盖均来自严格时间隔离的独立留出集，用于量化降低偏差费用的潜力，不构成电价投机、市场炒作或收益承诺。系统坚持人工复核和外部平台提交，不提供自动交易；实际降本金额须以完整结算证据核算。作品演示详见附件2；建议在附件4同步提供《策略独立验证报告》及测试验收材料，便于评审复核数据口径、模型门禁和安全边界。",
    ],
}


CAPS = {6: 800, 7: 500, 8: 500, 9: 200, 10: 600, 11: 600, 12: 300, 13: 600, 14: 200, 15: 1000, 16: 300, 17: 200, 18: 200, 19: 200}


def content_length(paragraphs: list[str]) -> int:
    return len("".join(paragraphs).replace(" ", ""))


def ensure_rpr(*, prose: bool) -> etree._Element:
    # Do not copy the source run properties. The template embeds a subsetted
    # FangSong font and also carries expanded character spacing, both of which
    # break newly inserted glyphs in LibreOffice. Use a complete system CJK
    # font and explicit sizing instead.
    rpr = etree.Element(QN("rPr"))
    rfonts = etree.SubElement(rpr, QN("rFonts"))
    for attr in ("ascii", "hAnsi", "eastAsia", "cs"):
        rfonts.set(QN(attr), EMBED_FONT_NAME)
    rfonts.set(QN("hint"), "eastAsia")
    for tag in ("sz", "szCs"):
        node = etree.SubElement(rpr, QN(tag))
        node.set(QN("val"), "24" if prose else "28")
    lang = etree.SubElement(rpr, QN("lang"))
    lang.set(QN("val"), "zh-CN")
    lang.set(QN("eastAsia"), "zh-CN")
    return rpr


def prepare_ppr(template_p: etree._Element | None, *, prose: bool) -> etree._Element:
    # Build a minimal pPr in schema order: spacing -> ind -> jc.
    ppr = etree.Element(QN("pPr"))
    spacing = etree.SubElement(ppr, QN("spacing"))
    spacing.set(QN("before"), "0")
    spacing.set(QN("after"), "0")
    spacing.set(QN("line"), "240")
    spacing.set(QN("lineRule"), "auto")
    ind = etree.SubElement(ppr, QN("ind"))
    ind.set(QN("firstLine"), "560" if prose else "0")
    jc = etree.SubElement(ppr, QN("jc"))
    jc.set(QN("val"), "left")
    return ppr


def replace_cell_paragraphs(tc: etree._Element, paragraphs: list[str], *, prose: bool) -> None:
    old_ps = tc.findall("w:p", NS)
    template_p = old_ps[0] if old_ps else None
    template_run = tc.find(".//w:r", NS)
    tcpr = tc.find("w:tcPr", NS)
    for child in list(tc):
        if child is not tcpr:
            tc.remove(child)
    for text in paragraphs:
        p = etree.SubElement(tc, QN("p"))
        p.append(prepare_ppr(template_p, prose=prose))
        r = etree.SubElement(p, QN("r"))
        r.append(ensure_rpr(prose=prose))
        t = etree.SubElement(r, QN("t"))
        if text.startswith(" ") or text.endswith(" ") or "  " in text:
            t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        t.text = text


def center_all_table_cells(table: etree._Element) -> None:
    for tc in table.findall(".//w:tc", NS):
        tcpr = tc.find("w:tcPr", NS)
        if tcpr is None:
            tcpr = etree.Element(QN("tcPr"))
            tc.insert(0, tcpr)
        valign = tcpr.find("w:vAlign", NS)
        if valign is None:
            valign = etree.SubElement(tcpr, QN("vAlign"))
        valign.set(QN("val"), "center")


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"源文件不存在：{SOURCE}")
    digest = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    if digest != EXPECTED_SHA256:
        raise SystemExit(f"源文件 SHA-256 已变化：{digest}")
    for row, cap in CAPS.items():
        length = content_length(CONTENT[row])
        if length > cap:
            raise SystemExit(f"第 {row + 1} 行超出字数限制：{length}/{cap}")

    with zipfile.ZipFile(SOURCE, "r") as zin:
        document_xml = zin.read("word/document.xml")
        root = etree.fromstring(document_xml)
        tables = root.xpath("/w:document/w:body/w:tbl", namespaces=NS)
        if len(tables) != 1:
            raise SystemExit(f"预期 1 张主表，实际 {len(tables)} 张")
        rows = tables[0].findall("w:tr", NS)
        if len(rows) != 20:
            raise SystemExit(f"预期 20 行，实际 {len(rows)} 行")
        center_all_table_cells(tables[0])
        for row_index, paragraphs in CONTENT.items():
            cells = rows[row_index].findall("w:tc", NS)
            if not cells:
                raise SystemExit(f"第 {row_index + 1} 行没有单元格")
            replace_cell_paragraphs(cells[-1], paragraphs, prose=row_index >= 6)

        patched_xml = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
        if not EMBED_FONT_PATH.exists():
            raise SystemExit(f"完整中文字体不存在：{EMBED_FONT_PATH}")
        embedded_font = bytearray(EMBED_FONT_PATH.read_bytes())
        key_bytes = EMBED_FONT_KEY.bytes[::-1]
        for index in range(min(32, len(embedded_font))):
            embedded_font[index] ^= key_bytes[index % 16]
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix="filled-form-", suffix=".docx", dir=OUTPUT.parent)
        os.close(fd)
        try:
            with zipfile.ZipFile(tmp_name, "w") as zout:
                for item in zin.infolist():
                    if item.filename == "word/document.xml":
                        payload = patched_xml
                    elif item.filename == EMBED_FONT_PACKAGE_PATH:
                        payload = bytes(embedded_font)
                    else:
                        payload = zin.read(item.filename)
                    zout.writestr(item, payload)
            Path(tmp_name).replace(OUTPUT)
        finally:
            if Path(tmp_name).exists():
                Path(tmp_name).unlink()

    print(f"输出：{OUTPUT}")
    for row, cap in CAPS.items():
        print(f"row={row} chars={content_length(CONTENT[row])}/{cap}")


if __name__ == "__main__":
    main()
