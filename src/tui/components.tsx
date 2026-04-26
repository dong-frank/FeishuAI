import React from "react";
import { Box, Text } from "ink";

import type { HistoryRow } from "./history.js";
import type { OutputTextPart } from "./output.js";

export const HISTORY_ROW_HEIGHT = 1;

export function HistoryRowLine({ row }: { row: HistoryRow }) {
  const style = {
    ...(row.color ? { color: row.color } : {}),
    ...(row.bold ? { bold: true } : {}),
  };
  return (
    <Box height={HISTORY_ROW_HEIGHT} overflow="hidden" flexWrap="nowrap">
      {row.parts
        ? row.parts.map((part, index) => <OutputPartText key={index} part={part} />)
        : <Text {...style}>{row.text}</Text>}
    </Box>
  );
}

function OutputPartText({ part }: { part: OutputTextPart }) {
  const style = {
    ...(part.color ? { color: part.color } : {}),
    ...(part.bold ? { bold: true } : {}),
  };

  return <Text {...style}>{part.text}</Text>;
}
