import {
  DEFAULT_AGENT_STATUS_WIDTH,
  DEFAULT_STATUS_PANE_WIDTH,
  DEFAULT_STATUS_TEXT,
  TUI_FOOTER_TIPS,
  TUI_USAGE_TIPS,
} from "./constants.js";

export type AgentKind = "command" | "lark";

export function getAgentDisplayName(agentKind?: AgentKind | undefined) {
  if (agentKind === "lark") {
    return "Friday";
  }

  if (agentKind === "command") {
    return "Linus";
  }

  return "Agent";
}

export function getStatusAgentsLoadingText({
  agentKind,
  agentCommand,
  activity = "waiting",
}: {
  agentKind?: AgentKind | undefined;
  agentCommand?: string | undefined;
  activity?: "waiting" | "reviewing" | undefined;
}) {
  const actionText = activity === "reviewing" ? "正在检查" : "正在处理";
  const kindText = getAgentDisplayName(agentKind);
  const commandText = agentCommand ? ` ${agentCommand}` : "";
  return `${kindText} ${actionText}${commandText} ...`;
}

export function getStatusLine({
  isRunning,
  isAgentWaiting,
  isAgentReviewing = false,
  agentKind,
  agentCommand,
  tipIndex = 0,
}: {
  isRunning: boolean;
  isAgentWaiting: boolean;
  isAgentReviewing?: boolean | undefined;
  agentKind?: AgentKind | undefined;
  agentCommand?: string | undefined;
  tipIndex?: number | undefined;
}) {
  if (isAgentWaiting) {
    return getStatusAgentsLoadingText({ agentKind, agentCommand });
  }

  if (isAgentReviewing) {
    return getStatusAgentsLoadingText({
      agentKind,
      agentCommand,
      activity: "reviewing",
    });
  }

  if (isRunning) {
    return "命令：正在执行 ...";
  }

  return TUI_USAGE_TIPS[tipIndex % TUI_USAGE_TIPS.length] ?? TUI_USAGE_TIPS[0] ?? DEFAULT_STATUS_TEXT;
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
      right: 0,
    };
  }

  const left = Math.max(8, columns - 4);
  return {
    left,
    right: 0,
  };
}

export function getAgentStatusWidth(columns: number | undefined) {
  return 0;
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
  return {
    left: getScrollingStatusText({
      text: TUI_FOOTER_TIPS,
      width: options.tipStatusWidth ?? getTerminalTextWidth(TUI_FOOTER_TIPS),
      offset: 0,
    }),
    right: "",
  };
}
