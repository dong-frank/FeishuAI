import { stripVTControlCharacters } from "node:util";

import type { CommandRunOutput } from "../runtime/command-runner.js";

export type OutputSection = {
  label: "help" | "output";
  body: string;
};

export type OutputTextPart = {
  text: string;
  color?: "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white" | "gray";
  bold?: boolean;
};

const SGR_COLOR_BY_CODE = new Map<number, NonNullable<OutputTextPart["color"]>>([
  [30, "gray"],
  [31, "red"],
  [32, "green"],
  [33, "yellow"],
  [34, "blue"],
  [35, "magenta"],
  [36, "cyan"],
  [37, "white"],
  [90, "gray"],
  [91, "red"],
  [92, "green"],
  [93, "yellow"],
  [94, "blue"],
  [95, "magenta"],
  [96, "cyan"],
  [97, "white"],
]);

export function sanitizeTuiText(text: string) {
  return stripVTControlCharacters(
    text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g, ""),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

export function getOutputSections(entry: CommandRunOutput): OutputSection {
  if (entry.kind === "help") {
    return {
      label: "help",
      body: sanitizeTuiText(entry.help),
    };
  }

  return {
    label: "output",
    body: [entry.stdout, entry.stderr]
      .filter(Boolean)
      .map((text) => sanitizeTuiText(text))
      .join(""),
  };
}

function normalizeTuiText(text: string) {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ");
}

export function parseAnsiTextParts(text: string): OutputTextPart[] {
  const safeText = normalizeTuiText(text)
    .replace(/\x1B\][\s\S]*?(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[(?![0-9;]*m)[0-?]*[ -/]*[@-~]/g, "");
  const parts: OutputTextPart[] = [];
  let color: OutputTextPart["color"];
  let bold = false;
  let lastIndex = 0;
  const sgrPattern = /\x1B\[([0-9;]*)m/g;

  function pushText(value: string) {
    if (!value) {
      return;
    }

    parts.push({
      text: value,
      ...(color ? { color } : {}),
      ...(bold ? { bold } : {}),
    });
  }

  for (const match of safeText.matchAll(sgrPattern)) {
    pushText(safeText.slice(lastIndex, match.index));
    const codes = (match[1] || "0").split(";").map((code) => Number(code || "0"));
    for (const code of codes) {
      if (code === 0) {
        color = undefined;
        bold = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 22) {
        bold = false;
      } else if (code === 39) {
        color = undefined;
      } else if (SGR_COLOR_BY_CODE.has(code)) {
        color = SGR_COLOR_BY_CODE.get(code);
      }
    }
    lastIndex = match.index + match[0].length;
  }

  pushText(safeText.slice(lastIndex));
  return parts;
}

export function getOutputTextParts(entry: CommandRunOutput): OutputTextPart[] {
  if (entry.kind === "help") {
    return parseAnsiTextParts(entry.help);
  }

  return [entry.stdout, entry.stderr]
    .filter(Boolean)
    .flatMap((text) => parseAnsiTextParts(text));
}

export function shouldShowClassificationLine() {
  return false;
}

export function getRenderedOutputText(output: OutputSection) {
  return output.body.trimEnd();
}

export function isHelpOutput(result: CommandRunOutput) {
  return result.kind === "help";
}
