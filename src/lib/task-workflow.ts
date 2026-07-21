import type { TaskStatus } from "@prisma/client";

/**
 * Board workflow: a card moves one forward step at a time and never backward.
 * The only "backward" path is DELIVERY_FAIL → a fresh TODO rework task (created
 * via the rework endpoint, not a drag). Managers/admins bypass this in the
 * controller. This module is pure so the rules can be unit-tested in isolation.
 */
export const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  TODO: ["IN_PROGRESS"],
  IN_PROGRESS: ["DEV_REVIEW"],
  DEV_REVIEW: ["DEV_DONE"],
  DEV_DONE: ["DELIVERY_DONE", "DELIVERY_FAIL"],
  DELIVERY_DONE: [],
  DELIVERY_FAIL: [],
};

/** Delivery-side targets — reserved for the handoff tester (or a manager). */
export const DELIVERY_TARGETS: readonly TaskStatus[] = [
  "DELIVERY_DONE",
  "DELIVERY_FAIL",
];

/** Terminal ("closed") statuses — excluded from open-work counts/filters. */
export const CLOSED_STATUSES: readonly TaskStatus[] = [
  "DELIVERY_DONE",
  "DELIVERY_FAIL",
];

/** Whether `to` is a legal single forward step from `from`. */
export function isAllowedTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Whether moving to `to` is a delivery-side (tester-only) move. */
export function isDeliveryTarget(to: TaskStatus): boolean {
  return DELIVERY_TARGETS.includes(to);
}
