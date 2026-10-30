/**
 * Upload goals (2026-10-30, Travis): how often a person means to send a video. The
 * dashboard shows a countdown to the next one, the notification sweep emails a
 * reminder shortly before it is due, and a team lead sees every member's goal.
 *
 * The clock runs from the person's last upload, or from the moment the goal was
 * chosen if that is later (an upload from before the goal does not count against it).
 * Pure functions, shared by the page, the cron and the emails.
 */
export type UploadGoal = "twice_weekly" | "weekly" | "twice_monthly" | "monthly";

export type GoalDef = {
  key: UploadGoal;
  /** The button and the lead's view: "Once a week". */
  label: string;
  /** The small print: "one every 7 days". */
  every: string;
  /** The period between videos. */
  hours: number;
  /** The reminder email goes out this long before the due date (and the dashboard turns amber). */
  remindHoursBefore: number;
};

export const GOALS: readonly GoalDef[] = [
  { key: "twice_weekly", label: "Twice a week", every: "one every 3 to 4 days", hours: 84, remindHoursBefore: 12 },
  { key: "weekly", label: "Once a week", every: "one every 7 days", hours: 168, remindHoursBefore: 24 },
  { key: "twice_monthly", label: "Twice a month", every: "one every 15 days", hours: 360, remindHoursBefore: 48 },
  { key: "monthly", label: "Once a month", every: "one every 30 days", hours: 720, remindHoursBefore: 72 },
];

export function goalDef(key: string | null | undefined): GoalDef | null {
  return GOALS.find((g) => g.key === key) ?? null;
}
export function isUploadGoal(v: unknown): v is UploadGoal {
  return typeof v === "string" && GOALS.some((g) => g.key === v);
}

export type GoalState = "ok" | "soon" | "overdue";
export type GoalStatus = {
  goal: GoalDef;
  /** When the clock started: the last upload, or the goal being chosen. */
  since: Date;
  sinceIsUpload: boolean;
  lastUploadAt: Date | null;
  dueAt: Date;
  /** Negative once overdue. */
  hoursLeft: number;
  state: GoalState;
  /** How much of the period has passed, 0 to 1. */
  fraction: number;
};

export function goalStatus(goal: string | null | undefined, setAt: string | Date | null | undefined, lastUploadAt: string | Date | null | undefined, now = new Date()): GoalStatus | null {
  const def = goalDef(goal);
  if (!def || !setAt) return null;
  const set = new Date(setAt);
  const last = lastUploadAt ? new Date(lastUploadAt) : null;
  const sinceIsUpload = !!last && last.getTime() > set.getTime();
  const since = sinceIsUpload ? last! : set;
  const period = def.hours * 3600_000;
  const dueAt = new Date(since.getTime() + period);
  const hoursLeft = (dueAt.getTime() - now.getTime()) / 3600_000;
  const state: GoalState = hoursLeft < 0 ? "overdue" : hoursLeft <= def.remindHoursBefore ? "soon" : "ok";
  const fraction = Math.min(1, Math.max(0, (now.getTime() - since.getTime()) / period));
  return { goal: def, since, sinceIsUpload, lastUploadAt: last, dueAt, hoursLeft, state, fraction };
}

/** A reminder is due when the due date is this close and no reminder went out for it yet. */
export function reminderDue(s: GoalStatus, remindedFor: string | Date | null | undefined): boolean {
  if (s.hoursLeft > s.goal.remindHoursBefore) return false;
  if (remindedFor && Math.abs(new Date(remindedFor).getTime() - s.dueAt.getTime()) < 1000) return false;
  return true;
}

/** "Due in 4 days", "Due tomorrow", "Due today", "3 days overdue". */
export function dueText(s: GoalStatus): string {
  const h = s.hoursLeft;
  if (h < -24) { const d = Math.floor(-h / 24); return `${d} day${d === 1 ? "" : "s"} overdue`; }
  if (h < 0) return "Due today, and overdue";
  if (h < 24) return "Due today";
  if (h < 48) return "Due tomorrow";
  return `Due in ${Math.round(h / 24)} days`;
}

/** "today", "yesterday", "12 days ago". */
export function daysAgo(date: Date, now = new Date()): string {
  const days = Math.floor((now.getTime() - date.getTime()) / 86400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** "Mon, Nov 3" (in UTC on the server; the site shows dates that way everywhere). */
export function formatDay(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
