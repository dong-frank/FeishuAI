export const TUI_USAGE_TIP_INTERVAL_MS = 4000;
export const TUI_STATUS_SCROLL_INTERVAL_MS = 350;
export const DEFAULT_AGENT_STATUS_WIDTH = 28;
export const DEFAULT_STATUS_PANE_WIDTH = 28;
export const TUI_USAGE_TIPS = [
  "Enter 执行命令",
  "Tab 请求 Linus 帮助",
  "→ 接受补全",
  "Ctrl+C 退出",
  "↑/↓ 切换历史命令",
  "帮助生成 commit message: git commit + Tab",
  "连接 Friday: lark init"
] as const;
export const TUI_FOOTER_TIPS = "[Enter]执行  [Tab]Agent  [↑↓]历史  [PgUp/PgDn]滚动  [Ctrl+C]退出";
export const DEFAULT_STATUS_TEXT = TUI_USAGE_TIPS[0];
export const WELCOME_TITLE = "GITX";
export const WELCOME_BANNER_LINES = [
  "  ____ ___ _____ __  __",
  " / ___|_ _|_   _|\\ \\/ /",
  "| |  _ | |  | |   \\  / ",
  "| |_| || |  | |   /  \\ ",
  " \\____|___| |_|  /_/\\_\\",
] as const;
export const WELCOME_SUBTITLE = "Git workflow assistant · 输入命令，或输入 exit 退出";
export const INPUT_HISTORY_MARGIN_BOTTOM = 1;
export const DEFAULT_HISTORY_VIEWPORT_HEIGHT = 14;
export const MIN_HISTORY_VIEWPORT_HEIGHT = 0;
export const RESERVED_TUI_CHROME_ROWS = 13;

export const STATUS_AGENTS_LOADING_TEXTS = [
  "思考中",
  "跑轮中"
] as const;

export const COMPLETION_GHOST_STYLE = {
  color: "black",
  dimColor: true,
} as const;

export const CURSOR_STYLE = {
  inverse: true,
} as const;
