export async function configureAdminNotificationPresentation(): Promise<void> {
  throw new Error("Platform-specific notification implementation was not resolved.");
}
export async function enableAdminPush(_token: string, _branchId: string): Promise<void> {
  throw new Error("Platform-specific notification implementation was not resolved.");
}
export async function disableAdminPush(_token: string): Promise<void> {
  throw new Error("Platform-specific notification implementation was not resolved.");
}
export async function refreshAdminPushIfEnabled(
  _token: string, _branchId: string, _enabled: boolean,
): Promise<void> {
  throw new Error("Platform-specific notification implementation was not resolved.");
}
export async function watchAdminNotificationResponses(
  _onOpenOrder: (orderId: string | null) => void,
): Promise<() => void> {
  throw new Error("Platform-specific notification implementation was not resolved.");
}

export type PushTestStatus = { permission: string; firebase: string; token: string; sound: string };
export async function adminPushTestStatus(): Promise<PushTestStatus> {
  throw new Error("Platform-specific implementation was not resolved.");
}
export async function adminTestLocalSound(): Promise<void> {
  throw new Error("Platform-specific implementation was not resolved.");
}
export async function adminTestRemotePush(_token: string, _branchId: string, _delaySeconds = 0): Promise<string> {
  throw new Error("Platform-specific implementation was not resolved.");
}
export function listenAdminTestReceipts(_token: string, _onReceipt: (testId: string) => void): () => void {
  throw new Error("Platform-specific implementation was not resolved.");
}

