/** Order transitions are validated by the backend, not the client. */
export type Role = "OWNER" | "MANAGER" | "KITCHEN" | "DRIVER" | "CUSTOMER";
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
