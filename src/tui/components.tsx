import React from "react";
import { Text } from "ink";

import type { HistoryRow } from "./history.js";
import type { OutputTextPart } from "./output.js";

export function HistoryRowLine({ row }: { row: HistoryRow }) {
  const style = {
    ...(row.color ? { color: row.color } : {}),
    ...(row.bold ? { bold: true } : {}),
  };
  return (
    <Text {...style}>
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

  return <Text {...style}>{part.text}</Text>;
}
