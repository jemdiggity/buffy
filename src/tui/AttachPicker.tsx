import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { KeyHints } from "./components/KeyHints.js";

interface AttachPickerProps {
  sessions: string[];
  onSelect: (session: string) => void;
  onCancel: () => void;
}

export function AttachPicker({ sessions, onSelect, onCancel }: AttachPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(sessions.length - 1, i + 1));
    } else if (key.return) {
      if (sessions[selectedIndex]) {
        onSelect(sessions[selectedIndex]);
      }
    } else if (key.escape) {
      onCancel();
    }
  });

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">No active sessions to attach to</Text>
        <KeyHints hints={[{ key: "Esc", action: "back" }]} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Select a session to attach:</Text>
      <Box flexDirection="column" marginTop={1}>
        {sessions.map((session, i) => (
          <Text key={session}>
            <Text color={i === selectedIndex ? "cyan" : undefined}>
              {i === selectedIndex ? " \u25b8 " : "   "}
            </Text>
            <Text>{session}</Text>
          </Text>
        ))}
      </Box>
      <KeyHints
        hints={[
          { key: "\u2191\u2193", action: "navigate" },
          { key: "Enter", action: "attach" },
          { key: "Esc", action: "back" },
        ]}
      />
    </Box>
  );
}
