import type { CustomerPushSettings } from "./push-preference";
export async function configureCustomerNotificationPresentation(): Promise<void> {
  throw new Error("Platform-specific notification implementation was not resolved.");
}
export async function getCustomerPushSettings(): Promise<CustomerPushSettings> {
  return { enabled: false, available: false, detail: "Thông báo không được hỗ trợ." };
}
export async function setCustomerPushEnabled(_accessToken: string, _enabled: boolean): Promise<void> {
  throw new Error("Platform-specific notification implementation was not resolved.");
}
export async function enableCustomerPush(_accessToken: string): Promise<void> {
  throw new Error("Platform-specific notification implementation was not resolved.");
}
export async function refreshCustomerPushIfAllowed(_accessToken: string): Promise<void> {
  throw new Error("Platform-specific notification implementation was not resolved.");
}
export async function watchCustomerNotificationResponses(
  _onOpenOrder: (orderId: string) => void,
): Promise<() => void> {
  throw new Error("Platform-specific notification implementation was not resolved.");
}

export type PushTestStatus = { permission: string; firebase: string; token: string; sound: string };
export async function customerPushTestStatus(): Promise<PushTestStatus> {
  throw new Error("Platform-specific implementation was not resolved.");
}
export async function customerTestLocalSound(): Promise<void> {
  throw new Error("Platform-specific implementation was not resolved.");
}
export async function customerTestRemotePush(_accessToken: string, _delaySeconds = 0): Promise<string> {
  throw new Error("Platform-specific implementation was not resolved.");
}
export type CustomerFcmTestState = { status: "scheduled" | "sent_to_fcm" | "failed" | "received_on_device"; received: boolean; failureCode?: string | null };
export async function customerPushRemoteTestStatus(_accessToken: string, _testId: string): Promise<CustomerFcmTestState> {
  throw new Error("Platform-specific implementation was not resolved.");
}
export function listenCustomerTestReceipts(_accessToken: string, _onReceipt: (testId: string) => void): () => void {
  throw new Error("Platform-specific implementation was not resolved.");
}
export async function disableCustomerPush(_accessToken: string): Promise<void> {
  throw new Error("Platform-specific implementation was not resolved.");
}
