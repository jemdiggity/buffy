export type MessageType =
  | "spawn_request"
  | "capacity_check"
  | "pr_ready"
  | "review_complete"
  | "revision_needed"
  | "alert"
  | "session_ended";

export type RoleName = "pm" | "cto" | "developer" | "hr";

export interface Message {
  id: number;
  from_role: RoleName;
  to_role: RoleName;
  type: MessageType;
  payload: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}

export interface SpawnRequestPayload {
  issue_number: number;
  repo: string;
  priority?: number;
}

export interface RevisionNeededPayload {
  issue_number: number;
  pr_number: number;
  branch: string;
  revision_count: number;
}

export interface ReviewCompletePayload {
  pr_number: number;
  issue_number: number;
  approved: boolean;
  summary: string;
}

export interface PRReadyPayload {
  pr_number: number;
  issue_number: number;
  branch: string;
}

export interface SessionEndedPayload {
  tmux_session: string;
  issue_number?: number;
  role: string;
  success: boolean;
  reason?: string;
}

export interface AlertPayload {
  level: "info" | "warning" | "error";
  message: string;
  context?: Record<string, unknown>;
}
