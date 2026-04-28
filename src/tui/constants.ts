export const TUI_USAGE_TIP_INTERVAL_MS = 4000;
export const TUI_STATUS_SCROLL_INTERVAL_MS = 350;
export const DEFAULT_AGENT_STATUS_WIDTH = 28;
export const DEFAULT_STATUS_PANE_WIDTH = 28;
export const TUI_USAGE_TIPS = [
  "按 Enter 执行命令",
  "按 Tab 请求 Agent 帮助",
  "按 → 接受命令或文件补全",
  "按 Ctrl+C 退出",
  "按 ↑/↓ 切换命令历史",
  "按 PageUp/PageDown 滚动输出历史",
  "输入 git commit -m 后按 Tab 生成 commit message",
  "执行 lark init 命令将连接飞书"
] as const;
export const DEFAULT_STATUS_TEXT = TUI_USAGE_TIPS[0];
export const WELCOME_TITLE = "Welcome to git-helper TUI";
export const WELCOME_SUBTITLE = "Type a command, or type exit to quit.";
export const INPUT_HISTORY_MARGIN_BOTTOM = 1;
export const DEFAULT_HISTORY_VIEWPORT_HEIGHT = 14;
export const MIN_HISTORY_VIEWPORT_HEIGHT = 0;
export const RESERVED_TUI_CHROME_ROWS = 13;

export const COMPLETION_GHOST_STYLE = {
  color: "black",
  dimColor: true,
} as const;

export const CURSOR_STYLE = {
  inverse: true,
} as const;
