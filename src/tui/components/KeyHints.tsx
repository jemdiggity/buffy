import React from "react";
import { Box, Text } from "ink";

interface KeyHint {
  key: string;
  action: string;
}

interface KeyHintsProps {
  hints: KeyHint[];
}

export function KeyHints({ hints }: KeyHintsProps) {
  return (
    <Box gap={2} marginTop={1}>
      {hints.map((hint) => (
        <Box key={hint.key}>
          <Text color="yellow">[{hint.key}]</Text>
          <Text> {hint.action}</Text>
        </Box>
      ))}
    </Box>
  );
}
