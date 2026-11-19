const en = {
  management: 'Model management', refreshConnections: 'Refresh connections', checkingConnection: 'Checking connection…',
  connectionFailed: 'Could not check the connection.', codexMissing: 'Install or update the Codex plugin to manage this connection.',
  codexConnected: 'Local Codex sign-in detected', codexDisconnected: 'Codex is not connected',
  codexEmptyCatalog: 'Signed in, but the local Codex model catalog is empty.',
  codexLoginStart: 'Run', codexLoginFinish: 'on the DSH host, then refresh this page.',
  availableCatalog: 'Available models', modelCount: '{count} models',
  search: 'Search all models…', providers: 'Providers', account: 'Account',
  models: 'Models', defaultAccount: 'Default account', deepseekAccount: 'DeepSeek account', deepseekKey: 'API key',
  back: 'Back to providers', empty: 'No models available', noMatches: 'No matching models', loading: 'Loading…',
  unavailable: 'Usage unavailable', balance: 'Account balance', balanceShort: 'Balance', bonus: 'Bonus balance',
  weekly: 'Weekly', window: 'Window', resets: 'Resets', left: '{value} left', plan: 'Plan', addOn: 'Add-on', organization: 'Organization',
  credits: 'Credits', selectionFailed: 'Could not select the model', catalogFailed: 'Could not load the model catalog',
};

const zh: typeof en = {
  management: '模型管理', refreshConnections: '刷新连接', checkingConnection: '正在检查连接…',
  connectionFailed: '未能检查连接。', codexMissing: '安装或更新 Codex 插件后可查看连接。',
  codexConnected: '检测到本机 Codex 登录', codexDisconnected: 'Codex 尚未连接',
  codexEmptyCatalog: '已登录，但本机 Codex 模型目录为空。',
  codexLoginStart: '在 DSH 宿主运行', codexLoginFinish: '后刷新本页。',
  availableCatalog: '可用模型', modelCount: '{count} 个模型',
  search: '搜索所有模型…', providers: '厂商', account: '账号',
  models: '模型', defaultAccount: '默认账号', deepseekAccount: 'DeepSeek 账号', deepseekKey: 'API Key',
  back: '返回厂商', empty: '暂无可用模型', noMatches: '没有匹配的模型', loading: '加载中…',
  unavailable: '用量暂不可用', balance: '账户余额', balanceShort: '余额', bonus: '赠金余额',
  weekly: '每周', window: '额度周期', resets: '重置时间', left: '剩余 {value}', plan: '套餐', addOn: '额外购买', organization: '组织',
  credits: 'Credits', selectionFailed: '无法选择模型', catalogFailed: '无法加载模型列表',
};

export const messages = { en, zh };
