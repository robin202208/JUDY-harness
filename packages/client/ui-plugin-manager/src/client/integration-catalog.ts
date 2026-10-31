/**
 * Static capability catalog for the plugin page's "系统集成" showcase.
 * Deliberately data-only: a system becomes `builtin` only when a shipped
 * connector (e.g. the IM bridge) already serves it; everything else is an
 * engagement we quote as custom integration work.
 */
import type { PluginManagerLocaleKey } from './locales.ts'

/** How a listed system is connected today. */
export type IntegrationStatus = 'builtin' | 'custom'

/** One external system family and the transports we use for it. */
export interface IntegrationSystem {
  readonly name: string
  readonly note: string
  readonly protocols: readonly string[]
  readonly status: IntegrationStatus
}

/** One industry grouping rendered as its own block. */
export interface IntegrationCategory {
  readonly key: 'office' | 'business' | 'industrial' | 'medical'
  readonly titleKey: PluginManagerLocaleKey
  readonly systems: readonly IntegrationSystem[]
}

/** The catalog the page renders. Keep names short enough for a 168px card. */
export const INTEGRATION_CATEGORIES: readonly IntegrationCategory[] = [
  {
    key: 'office',
    titleKey: 'integrations.cat.office',
    systems: [
      { name: '钉钉 DingTalk', note: '群机器人 · 审批 · 通讯录', protocols: ['Webhook', 'OpenAPI'], status: 'builtin' },
      { name: '企业微信 WeCom', note: '应用消息 · 通讯录 · 审批', protocols: ['OpenAPI'], status: 'builtin' },
      { name: '飞书 Feishu', note: '群机器人 · 多维表格 · 审批', protocols: ['Webhook', 'OpenAPI'], status: 'builtin' },
      { name: '企业邮箱', note: '邮件收发 · 归档 · 自动分派', protocols: ['IMAP', 'SMTP'], status: 'custom' },
      { name: 'Microsoft 365', note: 'Outlook · Teams · SharePoint', protocols: ['Graph API'], status: 'custom' },
      { name: 'Google Workspace', note: 'Gmail · Drive · Calendar', protocols: ['REST'], status: 'custom' },
      { name: 'OA 协同办公', note: '致远 · 泛微 · 蓝凌：流程与公文', protocols: ['REST', 'JDBC'], status: 'custom' },
      { name: '知识库', note: 'Confluence · 语雀 · Notion 文档同步', protocols: ['REST'], status: 'custom' },
    ],
  },
  {
    key: 'business',
    titleKey: 'integrations.cat.business',
    systems: [
      { name: 'SAP S/4HANA', note: '主数据 · 订单 · 库存', protocols: ['OData', 'RFC'], status: 'custom' },
      { name: '用友 YonBIP', note: '凭证 · 库存 · 供应链', protocols: ['OpenAPI', 'JDBC'], status: 'custom' },
      { name: '金蝶 云星空', note: '财务 · 供应链 · 生产', protocols: ['OpenAPI'], status: 'custom' },
      { name: 'Salesforce', note: '客户 · 商机 · 服务工单', protocols: ['REST'], status: 'custom' },
      { name: 'CRM 国产套件', note: '销售易 · 纷享销客', protocols: ['OpenAPI'], status: 'custom' },
      { name: 'HR 人事系统', note: '北森 · Moka：招聘与人事', protocols: ['REST'], status: 'custom' },
      { name: 'BI / 报表', note: '帆软 · Tableau 取数与回写', protocols: ['JDBC', 'REST'], status: 'custom' },
    ],
  },
  {
    key: 'industrial',
    titleKey: 'integrations.cat.industrial',
    systems: [
      { name: 'MES 制造执行', note: '工单 · 质检 · 追溯', protocols: ['REST', 'JDBC'], status: 'custom' },
      { name: 'SCADA 组态', note: '实时点位 · 报警 · 趋势', protocols: ['OPC UA'], status: 'custom' },
      { name: 'PLC 可编程控制器', note: '西门子 · 三菱 · 欧姆龙', protocols: ['OPC UA', 'Modbus TCP'], status: 'custom' },
      { name: '工业网关', note: '边缘采集 · 协议转换', protocols: ['MQTT', 'Sparkplug B'], status: 'custom' },
      { name: '机器人 / 具身智能', note: '任务下发 · 状态回传', protocols: ['ROS2', 'gRPC'], status: 'custom' },
      { name: '数字孪生', note: '场景联动 · 实时渲染', protocols: ['WebSocket'], status: 'custom' },
      { name: 'WMS / AGV', note: '仓储调度 · 路径任务', protocols: ['REST'], status: 'custom' },
      { name: '能源管理 EMS', note: '能耗 · 碳排 · 需量', protocols: ['Modbus TCP', 'IEC 104'], status: 'custom' },
    ],
  },
  {
    key: 'medical',
    titleKey: 'integrations.cat.medical',
    systems: [
      { name: 'HIS 医院信息系统', note: '挂号 · 医嘱 · 收费', protocols: ['HL7 v2', 'WebService'], status: 'custom' },
      { name: 'EMR 电子病历', note: '病历 · 诊断 · 医嘱闭环', protocols: ['HL7 FHIR'], status: 'custom' },
      { name: 'LIS 检验系统', note: '检验申请 · 结果回传', protocols: ['ASTM', 'HL7 v2'], status: 'custom' },
      { name: 'PACS 影像', note: '影像调阅 · 报告关联', protocols: ['DICOM'], status: 'custom' },
      { name: '医保结算', note: '结算 · 对账 · 目录', protocols: ['医保接口'], status: 'custom' },
      { name: '体检 / 随访', note: '队列 · 报告 · 触达', protocols: ['REST'], status: 'custom' },
      { name: 'CDR 临床数据中心', note: '数据治理 · 指标口径', protocols: ['FHIR', 'JDBC'], status: 'custom' },
    ],
  },
]
