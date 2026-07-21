import type { TaskStatus } from "@prisma/client";

/**
 * Board workflow: a card moves one forward step at a time and never backward.
 * Dev side runs TODO→IN_PROGRESS→DEV_REVIEW→DEV_DONE; the tester (handoff) then
 * runs DEV_DONE→TESTING→(DELIVERY_DONE|DELIVERY_FAIL). The only "backward" path
 * is DELIVERY_FAIL → a fresh TODO rework task (via the rework endpoint, not a
 * drag). Managers/admins bypass this in the controller. Pure module → unit-test.
 */
export const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  TODO: ["IN_PROGRESS"],
  IN_PROGRESS: ["DEV_REVIEW"],
  DEV_REVIEW: ["DEV_DONE"],
  DEV_DONE: ["TESTING"],
  TESTING: ["DELIVERY_DONE", "DELIVERY_FAIL"],
  DELIVERY_DONE: [],
  DELIVERY_FAIL: [],
};

/**
 * Tester-owned targets — moving a card INTO any of these is the handoff tester's
 * job (or a manager's): starting the test (TESTING) and the final verdict.
 */
export const TESTER_TARGETS: readonly TaskStatus[] = [
  "TESTING",
  "DELIVERY_DONE",
  "DELIVERY_FAIL",
];

/** Delivery verdicts (final tester decisions). */
export const DELIVERY_TARGETS: readonly TaskStatus[] = [
  "DELIVERY_DONE",
  "DELIVERY_FAIL",
];

/** Terminal ("closed") statuses — excluded from open-work counts/filters. */
export const CLOSED_STATUSES: readonly TaskStatus[] = [
  "DELIVERY_DONE",
  "DELIVERY_FAIL",
];

/** Open statuses currently owned by the handoff tester (not the dev). */
export const TESTER_OWNED_STATUSES: readonly TaskStatus[] = ["DEV_DONE", "TESTING"];

/** Whether `to` is a legal single forward step from `from`. */
export function isAllowedTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Whether moving to `to` is a tester-owned move (start test / final verdict). */
export function isTesterTarget(to: TaskStatus): boolean {
  return TESTER_TARGETS.includes(to);
}

/** Whether an open card in this status is the tester's responsibility, not the dev's. */
export function isTesterOwned(status: TaskStatus): boolean {
  return TESTER_OWNED_STATUSES.includes(status);
}
