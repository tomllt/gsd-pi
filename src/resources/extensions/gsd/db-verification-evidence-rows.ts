// Project/App: gsd-pi
// File Purpose: Verification evidence row contract for GSD workflow database consumers.

export interface VerificationEvidenceRow {
  id: number;
  task_id: string;
  slice_id: string;
  milestone_id: string;
  command: string;
  exit_code: number | null;
  verdict: string;
  duration_ms: number | null;
  created_at: string;
}
