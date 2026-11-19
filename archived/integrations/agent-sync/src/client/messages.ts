const zh = {
  connectors: '连接器', directory: '工作目录', directoryHint: '留空时同步全部目录', archived: '包含已归档会话',
  connected: '已连接', disconnected: '未连接', unavailable: '连接器暂不可用', connect: '连接并同步',
  sync: '立即同步', syncing: '正在同步…', disconnect: '断开', projects: '项目', sessions: '会话',
  syncedAt: '上次同步', fallback: '本机 Codex 未提供项目列表，会话按工作目录显示。',
  missingCodex: '找不到 Codex。请安装 ChatGPT 桌面应用或将 Codex CLI 加入 PATH。',
  codexFailed: '无法读取 Codex 数据。请检查本机 Codex 版本与登录状态。',
  syncTimeout: '同步超时，请重试。', invalidDirectory: '请输入 Host 上的绝对工作目录。',
  tooManyRecords: '会话或项目过多，请按工作目录缩小范围。', busy: '已有同步正在运行。',
  denied: '只有 Host 所有者可以连接 Codex。',
};
const en: typeof zh = {
  connectors: 'Connectors', directory: 'Working directory', directoryHint: 'Leave blank to sync all directories',
  archived: 'Include archived chats', connected: 'Connected', disconnected: 'Disconnected',
  unavailable: 'Connector unavailable', connect: 'Connect and sync', sync: 'Sync now', syncing: 'Syncing…',
  disconnect: 'Disconnect', projects: 'Projects', sessions: 'Chats', syncedAt: 'Last synced',
  fallback: 'This Codex installation does not expose projects. Chats are grouped by working directory.',
  missingCodex: 'Install the ChatGPT desktop app or add Codex CLI to PATH.',
  codexFailed: 'Could not read Codex data. Check the local Codex version and sign-in state.',
  syncTimeout: 'Sync timed out. Try again.', invalidDirectory: 'Enter an absolute working directory on the host.',
  tooManyRecords: 'Too many chats or projects. Filter by working directory.', busy: 'A sync is already running.',
  denied: 'Only the host owner can connect Codex.',
};
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { agentSync: keyof typeof zh }
}
export const messages = { zh, en };
