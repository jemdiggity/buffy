import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import { Panel } from "./components/Panel.js";
import { KeyHints } from "./components/KeyHints.js";
import type { PRManager, PRInfo, PRReview } from "../git/index.js";

interface ReviewViewProps {
  prNumber: number;
  prs: PRManager;
  onBack: () => void;
  onMerged: () => void;
}

export function ReviewView({ prNumber, prs, onBack, onMerged }: ReviewViewProps) {
  const { stdout } = useStdout();
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [prInfo, setPrInfo] = useState<PRInfo | null>(null);
  const [reviews, setReviews] = useState<PRReview[]>([]);
  const [diffLines, setDiffLines] = useState<string[]>([]);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const viewportHeight = Math.max((stdout?.rows ?? 24) - 16, 5);

  useEffect(() => {
    const load = async () => {
      try {
        const [info, revs, diff] = await Promise.all([
          prs.getPR(prNumber),
          prs.getReviews(prNumber),
          prs.getDiff(prNumber),
        ]);
        setPrInfo(info);
        setReviews(revs);
        setDiffLines(diff.split("\n"));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [prNumber]);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
    } else if (key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
    } else if (key.downArrow) {
      setScrollOffset((o) => Math.min(Math.max(0, diffLines.length - viewportHeight), o + 1));
    } else if (key.pageUp) {
      setScrollOffset((o) => Math.max(0, o - viewportHeight));
    } else if (key.pageDown) {
      setScrollOffset((o) => Math.min(Math.max(0, diffLines.length - viewportHeight), o + viewportHeight));
    } else if (input === "a" && prInfo && !merging) {
      setMerging(true);
      prs.mergePR(prNumber)
        .then(() => onMerged())
        .catch((err) => {
          setError(`Merge failed: ${err instanceof Error ? err.message : String(err)}`);
          setMerging(false);
        });
    } else if (input === "g" && prInfo) {
      import("execa").then(({ execa }) => {
        execa("gh", ["pr", "view", String(prNumber), "--web"]).catch(() => {});
      });
    }
  });

  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>
          <Spinner type="dots" /> Loading PR #{prNumber}...
        </Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">Error: {error}</Text>
        <Text color="gray">Press Esc to go back</Text>
      </Box>
    );
  }

  const latestReview = reviews.length > 0 ? reviews[reviews.length - 1] : null;
  const visibleDiff = diffLines.slice(scrollOffset, scrollOffset + viewportHeight);

  return (
    <Box flexDirection="column">
      {/* PR Header */}
      <Panel title={`PR #${prNumber}`}>
        <Text bold>{prInfo?.title}</Text>
        <Text color="gray">
          {prInfo?.headBranch} by {prInfo?.author}
        </Text>
      </Panel>

      {/* CTO Review Summary */}
      {latestReview && (
        <Panel title={`CTO Review (${latestReview.state})`}>
          <Text wrap="wrap">
            {latestReview.body || "(no comment)"}
          </Text>
        </Panel>
      )}

      {/* Diff */}
      <Panel title={`Diff (${scrollOffset + 1}-${Math.min(scrollOffset + viewportHeight, diffLines.length)} of ${diffLines.length} lines)`}>
        {visibleDiff.map((line, i) => (
          <Text key={scrollOffset + i} color={colorForDiffLine(line)}>
            {line}
          </Text>
        ))}
      </Panel>

      {merging && (
        <Box paddingX={1}>
          <Text color="yellow">
            <Spinner type="dots" /> Merging PR #{prNumber}...
          </Text>
        </Box>
      )}

      <KeyHints
        hints={[
          { key: "a", action: "approve & merge" },
          { key: "g", action: "open in GitHub" },
          { key: "\u2191\u2193", action: "scroll" },
          { key: "PgUp/PgDn", action: "page" },
          { key: "Esc", action: "back" },
        ]}
      />
    </Box>
  );
}

function colorForDiffLine(line: string): string | undefined {
  if (line.startsWith("+++") || line.startsWith("---")) return "white";
  if (line.startsWith("+")) return "green";
  if (line.startsWith("-")) return "red";
  if (line.startsWith("@@")) return "cyan";
  if (line.startsWith("diff ")) return "yellow";
  return undefined;
}
