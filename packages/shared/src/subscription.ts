/**
 * Subscription period calculation and QR access evaluation.
 * Shared so the kiosk can validate from its cache while offline with exactly the server's rules.
 */
import { AccessResult, RenewalPolicy, SubscriptionStatus } from './enums';

export interface CoverageEntry {
  subscriptionId: string;
  /** Opaque per-customer key (never the mobile number) used to chain renewals. */
  customerKey: string;
  startsAt: string;
  expiresAt: string;
  status: SubscriptionStatus;
  planTitle: string;
}

export interface Period {
  startsAt: Date;
  expiresAt: Date;
  /** true when the period was appended after existing coverage. */
  extended: boolean;
}

const DAY_MS = 86400000;

/** Latest end of ACTIVE coverage strictly after `at`, if any. */
export function currentCoverageEnd(entries: CoverageEntry[], at: Date): Date | null {
  let end: number | null = null;
  for (const e of entries) {
    if (e.status !== SubscriptionStatus.ACTIVE) continue;
    const exp = new Date(e.expiresAt).getTime();
    if (exp > at.getTime() && (end === null || exp > end)) end = exp;
  }
  return end === null ? null : new Date(end);
}

export function computePeriod(
  paidAt: Date,
  durationDays: number,
  customerEntries: CoverageEntry[],
  policy: RenewalPolicy,
): Period {
  let startsAt = paidAt;
  let extended = false;
  if (policy === RenewalPolicy.EXTEND_FROM_END) {
    const end = currentCoverageEnd(customerEntries, paidAt);
    if (end) {
      startsAt = end;
      extended = true;
    }
  }
  return { startsAt, expiresAt: new Date(startsAt.getTime() + durationDays * DAY_MS), extended };
}

export interface AccessEvaluation {
  result: AccessResult;
  valid: boolean;
  /** End of the member's continuous coverage (ACTIVE) or last expiry (EXPIRED). */
  expiresAt: string | null;
  /** For NOT_STARTED: when coverage begins. */
  startsAt: string | null;
  planTitle: string | null;
}

/**
 * @param entry the subscription matching the scanned token (undefined when unknown)
 * @param customerEntries every known subscription of the same customer (including `entry`)
 */
export function evaluateAccess(
  entry: CoverageEntry | undefined,
  customerEntries: CoverageEntry[],
  now: Date,
): AccessEvaluation {
  if (!entry) return { result: AccessResult.INVALID, valid: false, expiresAt: null, startsAt: null, planTitle: null };
  if (entry.status === SubscriptionStatus.CANCELLED) {
    return { result: AccessResult.REVOKED, valid: false, expiresAt: null, startsAt: null, planTitle: entry.planTitle };
  }
  const t = now.getTime();
  const active = customerEntries
    .filter((e) => e.status === SubscriptionStatus.ACTIVE)
    .map((e) => ({ s: new Date(e.startsAt).getTime(), x: new Date(e.expiresAt).getTime(), e }))
    .sort((a, b) => a.s - b.s);

  const covering = active.find((a) => a.s <= t && t < a.x);
  if (covering) {
    // Follow the renewal chain to find the end of continuous coverage.
    let end = covering.x;
    for (const a of active) {
      if (a.s <= end && a.x > end) end = a.x;
    }
    return {
      result: AccessResult.ACTIVE,
      valid: true,
      expiresAt: new Date(end).toISOString(),
      startsAt: null,
      planTitle: covering.e.planTitle,
    };
  }
  if (new Date(entry.startsAt).getTime() > t) {
    return {
      result: AccessResult.NOT_STARTED,
      valid: false,
      expiresAt: entry.expiresAt,
      startsAt: entry.startsAt,
      planTitle: entry.planTitle,
    };
  }
  const lastEnd = active.reduce((m, a) => (a.x <= t && a.x > m ? a.x : m), new Date(entry.expiresAt).getTime());
  return {
    result: AccessResult.EXPIRED,
    valid: false,
    expiresAt: new Date(lastEnd).toISOString(),
    startsAt: null,
    planTitle: entry.planTitle,
  };
}
