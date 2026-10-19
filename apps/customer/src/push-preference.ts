import AsyncStorage from "@react-native-async-storage/async-storage";

// Device-level preference survives logout and account changes. A denied/failed
// storage read must never silently turn notifications back on.
const PUSH_CHOICE_KEY = "sichuan.customer.push-choice.v1";
export type CustomerPushSettings = {
  enabled: boolean;
  available: boolean;
  detail: string;
};
export async function mayRefreshCustomerPush(): Promise<boolean> {
  return (await AsyncStorage.getItem(PUSH_CHOICE_KEY)) !== "disabled";
}
export async function saveCustomerPushChoice(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(PUSH_CHOICE_KEY, enabled ? "enabled" : "disabled");
}

// All background refreshes, explicit toggles and logout unregistrations are
// serialized. A refresh started before "off" cannot restore a subscription after it.
let pendingPushWork: Promise<unknown> = Promise.resolve();
export function queueCustomerPushWork<T>(action: () => Promise<T>): Promise<T> {
  const result = pendingPushWork.then(action, action);
  pendingPushWork = result.catch(() => undefined);
  return result;
}
