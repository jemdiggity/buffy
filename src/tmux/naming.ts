export interface ParsedSessionName {
  project: string;
  role: "pm" | "cto" | "developer";
  issueNumber?: number;
}

export function pmSessionName(project: string): string {
  return `buffy-${project}-pm`;
}

export function ctoSessionName(project: string): string {
  return `buffy-${project}-cto`;
}

export function devSessionName(project: string, issueNumber: number): string {
  return `buffy-${project}-dev-${issueNumber}`;
}

export function isBuffySession(name: string): boolean {
  return name.startsWith("buffy-");
}

export function parseSessionName(name: string): ParsedSessionName | null {
  if (!isBuffySession(name)) return null;

  const parts = name.slice("buffy-".length).split("-");
  if (parts.length < 2) return null;

  // The role is the last meaningful part (or last two for "dev-{number}")
  // Pattern: buffy-{project}-pm, buffy-{project}-cto, buffy-{project}-dev-{number}
  const lastPart = parts[parts.length - 1]!;
  const secondToLast = parts.length >= 3 ? parts[parts.length - 2] : undefined;

  if (secondToLast === "dev" && /^\d+$/.test(lastPart)) {
    return {
      project: parts.slice(0, -2).join("-"),
      role: "developer",
      issueNumber: parseInt(lastPart, 10),
    };
  }

  if (lastPart === "pm" || lastPart === "cto") {
    return {
      project: parts.slice(0, -1).join("-"),
      role: lastPart,
    };
  }

  return null;
}
