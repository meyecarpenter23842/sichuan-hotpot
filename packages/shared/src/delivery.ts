/**
 * Pure server-authoritative delivery fee calculation.
 * distanceMeters MUST come from a road-routing provider, never a straight-line distance.
 * This module does not perform HTTP calls or accept frontend-calculated fees.
 */

export type DeliveryQuoteErrorCode =
  | "STORE_CLOSED"
  | "INVALID_POLICY"
  | "INVALID_SUBTOTAL"
  | "BELOW_MINIMUM"
  | "ROUTE_UNAVAILABLE"
  | "OUT_OF_RANGE";

export class DeliveryQuoteError extends Error {
  constructor(public readonly code: DeliveryQuoteErrorCode) {
    super(code);
    this.name = "DeliveryQuoteError";
  }
}

export interface DeliveryPolicy {
  /** Version persisted with order snapshots so future edits do not reprice past orders. */
  readonly versionId: string;
  readonly acceptingOrders: boolean;
  readonly baseMeters: number;
  readonly baseFeeVnd: number;
  /** Each started distance step past baseMeters adds one additional step fee. */
  readonly extraStepMeters: number;
  readonly extraStepFeeVnd: number;
  readonly maxRoadMeters: number;
  readonly minSubtotalVnd: number;
  /** Null disables free delivery; 0 explicitly means all eligible orders are free. */
  readonly freeDeliveryAtSubtotalVnd: number | null;
}

export interface DeliveryQuote {
  readonly policyVersionId: string;
  readonly routeDistanceMeters: number;
  readonly subtotalVnd: number;
  readonly feeVnd: number;
  readonly extraSteps: number;
  readonly totalVnd: number;
  readonly freeDeliveryApplied: boolean;
}

function validVnd(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function quoteDelivery(
  subtotalVnd: number,
  roadRouteMeters: number | null,
  policy: DeliveryPolicy,
): DeliveryQuote {
  const numeric = [
    policy.baseMeters, policy.baseFeeVnd, policy.extraStepMeters,
    policy.extraStepFeeVnd, policy.maxRoadMeters, policy.minSubtotalVnd,
  ];
  if (
    !policy.versionId.trim()
    || numeric.some((n) => !validVnd(n))
    || policy.extraStepMeters === 0
    || policy.maxRoadMeters === 0
    || policy.baseMeters > policy.maxRoadMeters
    || (policy.freeDeliveryAtSubtotalVnd !== null && !validVnd(policy.freeDeliveryAtSubtotalVnd))
  ) {
    throw new DeliveryQuoteError("INVALID_POLICY");
  }
  if (!validVnd(subtotalVnd)) throw new DeliveryQuoteError("INVALID_SUBTOTAL");
  if (!policy.acceptingOrders) throw new DeliveryQuoteError("STORE_CLOSED");
  if (subtotalVnd < policy.minSubtotalVnd) throw new DeliveryQuoteError("BELOW_MINIMUM");

  // Unrouteable/zero/invalid distances always block checkout. Never silently charge 0 VND.
  if (roadRouteMeters === null || !Number.isSafeInteger(roadRouteMeters) || roadRouteMeters <= 0) {
    throw new DeliveryQuoteError("ROUTE_UNAVAILABLE");
  }
  if (roadRouteMeters > policy.maxRoadMeters) throw new DeliveryQuoteError("OUT_OF_RANGE");

  const extraSteps = Math.ceil(
    Math.max(0, roadRouteMeters - policy.baseMeters) / policy.extraStepMeters,
  );
  const fee = policy.baseFeeVnd + extraSteps * policy.extraStepFeeVnd;
  const freeDeliveryApplied =
    policy.freeDeliveryAtSubtotalVnd !== null
    && subtotalVnd >= policy.freeDeliveryAtSubtotalVnd;
  const feeVnd = freeDeliveryApplied ? 0 : fee;
  const totalVnd = subtotalVnd + feeVnd;
  if (!validVnd(feeVnd) || !validVnd(totalVnd)) {
    throw new DeliveryQuoteError("INVALID_POLICY");
  }
  return {
    policyVersionId: policy.versionId,
    routeDistanceMeters: roadRouteMeters,
    subtotalVnd,
    feeVnd,
    extraSteps,
    totalVnd,
    freeDeliveryApplied,
  };
}
