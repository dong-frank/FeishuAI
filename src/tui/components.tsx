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
  const rightColor = row.rightColor ?? row.color;

  return (
    <Box
      height={HISTORY_ROW_HEIGHT}
      overflow="hidden"
      flexWrap="nowrap"
      justifyContent={row.rightText ? "space-between" : "flex-start"}
      width="100%"
    >
      <Box overflow="hidden" flexShrink={1}>
        {row.parts
          ? row.parts.map((part, index) => <OutputPartText key={index} part={part} />)
          : <Text {...style}>{row.text}</Text>}
      </Box>
      {row.rightText ? <RightStatusText color={rightColor} text={row.rightText} /> : null}
    </Box>
  );
}

function RightStatusText({
  color,
  text,
}: {
  color?: HistoryRow["rightColor"] | undefined;
  text: string;
}) {
  if (color) {
    return <Text color={color}>{text}</Text>;
  }

  return <Text>{text}</Text>;
}

function OutputPartText({ part }: { part: OutputTextPart }) {
  const style = {
    ...(part.color ? { color: part.color } : {}),
    ...(part.bold ? { bold: true } : {}),
  };

  return <Text {...style}>{part.text}</Text>;
}
