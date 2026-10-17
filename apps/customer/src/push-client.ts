export async function configureCustomerNotificationPresentation(): Promise<void> {
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
