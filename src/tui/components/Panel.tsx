import React from "react";
import { Box, Text } from "ink";

interface PanelProps {
  title: string;
  children: React.ReactNode;
  width?: number;
}

export function Panel({ title, children, width }: PanelProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" width={width} paddingX={1}>
      <Text bold color="cyan">{title}</Text>
      {children}
    </Box>
  );
}
