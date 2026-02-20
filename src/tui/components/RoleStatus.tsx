import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";

interface RoleStatusProps {
  name: string;
  status: string;
  active?: boolean;
}

export function RoleStatus({ name, status, active }: RoleStatusProps) {
  return (
    <Box gap={1}>
      <Text color={active ? "green" : "gray"}>{active ? "\u25cf" : "\u25cb"}</Text>
      <Text bold>{name}</Text>
      {active ? (
        <Box>
          <Text color="gray"><Spinner type="dots" /></Text>
          <Text color="gray"> {status}</Text>
        </Box>
      ) : (
        <Text color="gray">{status}</Text>
      )}
    </Box>
  );
}
