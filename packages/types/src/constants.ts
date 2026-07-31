/** Engine + trip-flow tuning knobs, shared by api and dispatch. */
export const ENGINE = {
  /** driver takes a break after this many consecutive trips */
  MAX_TRIPS_BEFORE_BREAK: 4,
  /** minimum break length */
  BREAK_MINUTES: 15,
  /** max acceptable detour added to an in-progress trip */
  MAX_DETOUR_ADDED_SECONDS: 8 * 60,
  /** guests to the same accommodation within this window get clustered */
  CLUSTER_WINDOW_MINUTES: 20,
  /** wait-queue aging: seconds of waiting that equal 1 "priority point" */
  AGING_HALF_LIFE_SECONDS: 300,
  /** re-optimization: ignore ETA changes smaller than this (anti-thrash) */
  REOPT_THRESHOLD_SECONDS: 120,
  /** default pickup deadline if none provided: ETA + this */
  DEFAULT_DEADLINE_MINUTES: 45,
  /** engine tick */
  TICK_MS: Number(process.env.DISPATCH_TICK_MS ?? 5000),
} as const;
