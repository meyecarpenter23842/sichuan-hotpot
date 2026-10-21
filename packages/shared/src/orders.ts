/** Order transitions are validated by the backend, not the client. */
export type Role = "OWNER" | "MANAGER" | "KITCHEN" | "DRIVER" | "CUSTOMER" | "WAITER" | "CASHIER";
export type OrderStatus =
  | "PENDING" | "CONFIRMED" | "PREPARING" | "READY"
  | "DELIVERING" | "DELIVERED" | "CANCELED" | "DELIVERY_FAILED";

export class OrderTransitionError extends Error {
  constructor() {
    super("INVALID_ORDER_TRANSITION");
    this.name = "OrderTransitionError";
  }
}

const managers: readonly Role[] = ["OWNER", "MANAGER"];
const kitchen: readonly Role[] = ["OWNER", "MANAGER", "KITCHEN"];

export interface OrderTransitionRequest {
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  readonly role: Role;
  /** Verified by server from delivery assignment; cannot be supplied by frontend. */
  readonly isAssignedDriver: boolean;
}

export function canTransitionOrder(request: OrderTransitionRequest): boolean {
  const { from, to, role, isAssignedDriver } = request;
  if (from === to) return false;
  switch (from) {
    case "PENDING":
      if (to === "CONFIRMED") return managers.includes(role);
      if (to === "CANCELED") return managers.includes(role) || role === "CUSTOMER";
      return false;
    case "CONFIRMED":
      if (to === "PREPARING") return kitchen.includes(role);
      if (to === "CANCELED") return managers.includes(role);
      return false;
    case "PREPARING":
      return to === "READY" && kitchen.includes(role);
    case "READY":
      // The shop can self-deliver before dedicated driver dispatch (P5) is configured.
      // Assigned DRIVERs remain scoped to their own deliveries.
      return to === "DELIVERING" && (
        managers.includes(role) || (role === "DRIVER" && isAssignedDriver)
      );
    case "DELIVERING":
      if (to === "DELIVERED" || to === "DELIVERY_FAILED") {
        return managers.includes(role) || (role === "DRIVER" && isAssignedDriver);
      }
      return false;
    case "DELIVERY_FAILED":
      return to === "DELIVERING" && (
        managers.includes(role) || (role === "DRIVER" && isAssignedDriver)
      );
    case "DELIVERED":
    case "CANCELED":
      return false;
  }
}

export function assertOrderTransition(request: OrderTransitionRequest): void {
  if (!canTransitionOrder(request)) throw new OrderTransitionError();
}


/** A reorder creates a NEW cart; it is never a retry or transition of an active order. */
export function canReorderDeliveredOrder(status: string): boolean {
  return status === "DELIVERED";
}

export interface HistoricalPurchaseSelection {
  readonly productId: string | null;
  readonly productName: string;
  readonly variantName: string | null;
  readonly modifiers: readonly { readonly name: string; readonly priceVnd: number }[];
  readonly comboItems: readonly {
    readonly kind: "FIXED" | "CHOICE";
    readonly groupName: string | null;
    readonly productId: string | null;
    readonly variantId: string | null;
    readonly modifierOptionId: string | null;
    readonly productName: string;
    readonly variantName: string | null;
    readonly quantity: number;
    readonly priceDeltaVnd: number;
  }[];
}

/** Key from immutable order snapshots, not current menu prices.
 * Prevent different combo choices, variant sizes and topping multiplicity
 * from being collapsed into one purchased-product row. Sorting is intentional:
 * the order of historical snapshot rows is not part of a customer's choice. */
export function historicalPurchaseKey(
  branchId: string, item: HistoricalPurchaseSelection,
): string {
  // A new menu price must not turn the SAME selection into a different purchase.
  const modifiers = item.modifiers.map(mod => [mod.name]);
  const combo = item.comboItems.map(child => [
    child.kind, child.groupName, child.productId, child.variantId,
    child.modifierOptionId, child.productName, child.variantName,
    child.quantity,
  ]);
  const canonical = (values: unknown[][]) =>
    values.map(entry => JSON.stringify(entry)).sort();
  return JSON.stringify([branchId,
    item.productId ? ["id", item.productId] : ["historical-name", item.productName],
    item.variantName,
    canonical(modifiers), canonical(combo)]);
}
