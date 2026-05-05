import {
  DEFAULT_AGENT_STATUS_WIDTH,
  DEFAULT_STATUS_PANE_WIDTH,
  DEFAULT_STATUS_TEXT,
  TUI_FOOTER_TIPS,
  TUI_USAGE_TIPS,
} from "./constants.js";
import type { AgentContextUsage } from "../agent/types.js";

export type AgentKind = "command" | "lark";
export type ContextMeterState = Partial<Record<AgentKind, AgentContextUsage>>;
export type StatusTextPart = {
  text: string;
  color?: "gray" | "green" | "yellow" | "red" | undefined;
};

export const DEFAULT_MAX_CONTEXT_WINDOW = 256000;
export const CONTEXT_METER_STATUS_WIDTH = getTerminalTextWidth("Linus ●  Friday ●");

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

  const right = columns >= 72 ? CONTEXT_METER_STATUS_WIDTH : 0;
  const left = Math.max(8, columns - 4 - right);
  return {
    left,
    right,
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
    contextMeters?: ContextMeterState | undefined;
    maxContextWindow?: number | undefined;
  },
) {
  return {
    left: getScrollingStatusText({
      text: TUI_FOOTER_TIPS,
      width: options.tipStatusWidth ?? getTerminalTextWidth(TUI_FOOTER_TIPS),
      offset: 0,
    }),
    right:
      (options.agentStatusWidth ?? 0) > 0
        ? formatContextMeterParts(
            options.contextMeters,
            options.maxContextWindow ?? resolveMaxContextWindow(),
          )
        : [],
  };
}

export function resolveMaxContextWindow(
  env: Partial<Pick<NodeJS.ProcessEnv, "MAX_CONTEXT_WINDOW">> = process.env,
) {
  const parsed = Number.parseInt(env.MAX_CONTEXT_WINDOW ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_CONTEXT_WINDOW;
}

export function getContextProgressSymbol(
  usage: Pick<AgentContextUsage, "estimatedTokens"> | undefined,
  maxContextWindow: number = DEFAULT_MAX_CONTEXT_WINDOW,
) {
  const ratio = getContextUsageRatio(usage, maxContextWindow);
  if (ratio <= 0) {
    return "○";
  }
  if (ratio <= 0.25) {
    return "◔";
  }
  if (ratio <= 0.5) {
    return "◑";
  }
  if (ratio <= 0.75) {
    return "◕";
  }

  return "●";
}

export function getContextProgressColor(
  usage: Pick<AgentContextUsage, "estimatedTokens"> | undefined,
  maxContextWindow: number = DEFAULT_MAX_CONTEXT_WINDOW,
): StatusTextPart["color"] {
  const ratio = getContextUsageRatio(usage, maxContextWindow);
  if (ratio <= 0) {
    return "gray";
  }
  if (ratio <= 0.25) {
    return "green";
  }
  if (ratio <= 0.75) {
    return "yellow";
  }

  return "red";
}

export function formatContextMeterParts(
  meters: ContextMeterState | undefined,
  maxContextWindow: number = DEFAULT_MAX_CONTEXT_WINDOW,
): StatusTextPart[] {
  return [
    { text: "Linus " },
    {
      text: getContextProgressSymbol(meters?.command, maxContextWindow),
      color: getContextProgressColor(meters?.command, maxContextWindow),
    },
    { text: "  Friday " },
    {
      text: getContextProgressSymbol(meters?.lark, maxContextWindow),
      color: getContextProgressColor(meters?.lark, maxContextWindow),
    },
  ];
}

function getContextUsageRatio(
  usage: Pick<AgentContextUsage, "estimatedTokens"> | undefined,
  maxContextWindow: number,
) {
  if (!usage || usage.estimatedTokens <= 0 || maxContextWindow <= 0) {
    return 0;
  }

  return usage.estimatedTokens / maxContextWindow;
}
