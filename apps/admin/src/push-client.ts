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
