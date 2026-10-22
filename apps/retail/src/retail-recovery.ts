import type { CartLine, Submission } from "./pos-api";

export type FrozenTicket = {
  staffId: string; branchId: string; tableId: string;
  sessionId: string; payload: Submission; cart: CartLine[]; note: string;
};
export type FrozenPayment = {
  key: string; sessionId: string; method: "CASH" | "QR"; amountVnd: number;
  cashReceivedVnd?: number;
};
// Web stays in-memory. Android overrides these methods to persist uncertain sends.
export async function loadFrozenTicket(): Promise<FrozenTicket | null> { return null; }
export async function writeFrozenTicket(_ticket: FrozenTicket | null): Promise<void> {}
export async function loadFrozenPayment(_branchId: string, _sessionId: string): Promise<FrozenPayment | null> {
  return null;
}
export async function writeFrozenPayment(_branchId: string, _sessionId: string,
  _payment: FrozenPayment | null): Promise<void> {}
