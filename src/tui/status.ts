import {
  DEFAULT_AGENT_STATUS_WIDTH,
  DEFAULT_STATUS_PANE_WIDTH,
  DEFAULT_STATUS_TEXT,
  TUI_USAGE_TIPS,
} from "./constants.js";

export function getStatusLine({
  isRunning,
  isAgentWaiting,
  isCommitMessageGenerating = false,
  isAgentReviewing = false,
  agentCommand,
  isBeforeRunPending = false,
  pendingCommand,
  tipIndex = 0,
}: {
  isRunning: boolean;
  isAgentWaiting: boolean;
  isCommitMessageGenerating?: boolean | undefined;
  isAgentReviewing?: boolean | undefined;
  agentCommand?: string | undefined;
  isBeforeRunPending?: boolean | undefined;
  pendingCommand?: string | undefined;
  tipIndex?: number | undefined;
}) {
  if (isCommitMessageGenerating) {
    return `Agent：正在生成提交信息 ${agentCommand ?? "git commit -m"} ...`;
  }

  if (isAgentWaiting) {
    return `Agent：正在请求帮助 ${agentCommand ?? "command"} ...`;
  }

  if (isAgentReviewing) {
    return `Agent：正在检查 ${agentCommand ?? "command"} ...`;
  }

  if (isRunning) {
    return "命令：正在执行 ...";
  }

  if (isBeforeRunPending) {
    return `Agent：等待触发 ${pendingCommand ?? "command"}`;
  }

  return TUI_USAGE_TIPS[tipIndex % TUI_USAGE_TIPS.length] ?? DEFAULT_STATUS_TEXT;
}

function getTerminalCharacterWidth(character: string) {
  if (!character) {
    return 0;
  }

  if (/[\u0300-\u036F]/.test(character)) {
    return 0;
  }

  return /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(
    character,
  )
    ? 2
    : 1;
}

export function getTerminalTextWidth(text: string) {
  return Array.from(text).reduce(
    (width, character) => width + getTerminalCharacterWidth(character),
    0,
  );
}

function sliceTerminalTextByWidth(text: string, startWidth: number, maxWidth: number) {
  if (maxWidth <= 0) {
    return "";
  }

  let currentWidth = 0;
  let result = "";
  for (const character of Array.from(text)) {
    const characterWidth = getTerminalCharacterWidth(character);
    const nextWidth = currentWidth + characterWidth;
    if (nextWidth <= startWidth) {
      currentWidth = nextWidth;
      continue;
    }

    const resultWidth = getTerminalTextWidth(result);
    if (resultWidth + characterWidth > maxWidth) {
      break;
    }

    result += character;
    currentWidth = nextWidth;
  }

  return result;
}

export function getStatusPaneWidths(columns: number | undefined) {
  if (!columns) {
    return {
      left: DEFAULT_STATUS_PANE_WIDTH,
      right: DEFAULT_STATUS_PANE_WIDTH,
    };
  }

  const contentWidth = Math.max(16, columns - 12);
  const left = Math.max(8, Math.floor(contentWidth / 2));
  return {
    left,
    right: Math.max(8, contentWidth - left),
  };
}

export function getAgentStatusWidth(columns: number | undefined) {
  if (!columns) {
    return DEFAULT_AGENT_STATUS_WIDTH;
  }

  return getStatusPaneWidths(columns).right;
}

export function getScrollingStatusText({
  text,
  width = DEFAULT_AGENT_STATUS_WIDTH,
  offset = 0,
}: {
  text: string;
  width?: number | undefined;
  offset?: number | undefined;
}) {
  if (width <= 0) {
    return "";
  }

  const textWidth = getTerminalTextWidth(text);
  if (textWidth <= width) {
    return text;
  }

  if (width <= 3) {
    return ".".repeat(width);
  }

  const maxOffset = Math.max(0, textWidth - width + 3);
  const safeOffset = Math.min(Math.max(offset, 0), maxOffset);

  if (safeOffset === 0) {
    return `${sliceTerminalTextByWidth(text, 0, width - 3)}...`;
  }

  if (safeOffset >= maxOffset) {
    return `...${sliceTerminalTextByWidth(text, textWidth - width + 3, width - 3)}`;
  }

  if (width <= 6) {
    return `${sliceTerminalTextByWidth(text, safeOffset, width - 3)}...`;
  }

  return `...${sliceTerminalTextByWidth(text, safeOffset, width - 6)}...`;
}

export function getStatusBarParts(
  options: Parameters<typeof getStatusLine>[0] & {
    agentStatusWidth?: number | undefined;
    tipStatusWidth?: number | undefined;
    tipStatusScrollOffset?: number | undefined;
    agentStatusScrollOffset?: number | undefined;
  },
) {
  const tip = TUI_USAGE_TIPS[(options.tipIndex ?? 0) % TUI_USAGE_TIPS.length] ?? DEFAULT_STATUS_TEXT;
  const right = getStatusLine({
    ...options,
    tipIndex: 0,
  });
  const agentStatus = right === DEFAULT_STATUS_TEXT ? "Agent：空闲" : right;

  return {
    left: getScrollingStatusText({
      text: tip,
      width: options.tipStatusWidth,
      offset: options.tipStatusScrollOffset,
    }),
    right: getScrollingStatusText({
      text: agentStatus,
      width: options.agentStatusWidth,
      offset: options.agentStatusScrollOffset,
    }),
  };
}
