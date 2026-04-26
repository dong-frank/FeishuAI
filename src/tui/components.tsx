import React from "react";
import { Text } from "ink";

import type { HistoryRow } from "./history.js";
import type { OutputTextPart } from "./output.js";

export const HISTORY_ROW_WRAP_MODE = "truncate-end";

export function HistoryRowLine({ row }: { row: HistoryRow }) {
  const style = {
    ...(row.color ? { color: row.color } : {}),
    ...(row.bold ? { bold: true } : {}),
  };
  return (
    <Text {...style} wrap={HISTORY_ROW_WRAP_MODE}>
      {row.parts
        ? row.parts.map((part, index) => <OutputPartText key={index} part={part} />)
        : row.text}
    </Text>
  );
}

function OutputPartText({ part }: { part: OutputTextPart }) {
  const style = {
    ...(part.color ? { color: part.color } : {}),
    ...(part.bold ? { bold: true } : {}),
  };

  return <Text {...style} wrap={HISTORY_ROW_WRAP_MODE}>{part.text}</Text>;
}
