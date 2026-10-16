import type { ComboGroup, Product } from "./api";

export interface ComboChoice {
  id: string;
  sourceType: "PRODUCT" | "TOPPING";
  sourceId: string;
  name: string;
  imageKey: string | null | undefined;
  sourceGroupName: string | null;
  isAvailable: boolean;
  quantity: number;
  priceDeltaVnd: number;
  sortOrder: number;
  variantId: string | null;
  variantName: string | null;
}

export function comboGroupChoices(group: ComboGroup): ComboChoice[] {
  const products: ComboChoice[] = group.options.map(option => ({
    id: option.id,
    sourceType: "PRODUCT",
    sourceId: option.childProduct.id,
    name: option.childProduct.name,
    imageKey: option.childProduct.imageKey,
    sourceGroupName: null,
    isAvailable: option.childProduct.kind === "STANDARD"
      && option.childProduct.isAvailable && (option.variant == null || option.variant.isAvailable),
    quantity: option.quantity,
    priceDeltaVnd: option.priceDeltaVnd,
    sortOrder: option.sortOrder,
    variantId: option.variant?.id ?? null,
    variantName: option.variant?.name ?? null,
  }));
  const toppings: ComboChoice[] = (group.modifierOptions ?? []).map(option => ({
    id: option.id,
    sourceType: "TOPPING",
    sourceId: option.modifierOption.id,
    name: option.modifierOption.name,
    imageKey: option.modifierOption.imageKey,
    sourceGroupName: option.modifierOption.group.name,
    isAvailable: option.modifierOption.isAvailable && option.modifierOption.group.isAvailable,
    quantity: option.quantity,
    priceDeltaVnd: option.priceDeltaVnd,
    sortOrder: option.sortOrder,
    variantId: null,
    variantName: null,
  }));
  return [...products, ...toppings].sort((a, b) =>
    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi") || a.id.localeCompare(b.id));
}

export function comboSelectionError(product: Product, optionIds: readonly string[]): string | null {
  if (optionIds.length > 30) return "Combo có quá nhiều lựa chọn.";
  if (product.kind !== "COMBO") {
    return optionIds.length ? "Món thường không nhận lựa chọn combo." : null;
  }
  if (product.comboFixedItems.length === 0 && product.comboGroups.length === 0) {
    return "Combo chưa được cửa hàng thiết lập đầy đủ.";
  }
  if (product.comboFixedItems.some(item =>
    item.quantity < 1 || item.childProduct.kind !== "STANDARD" || !item.childProduct.isAvailable
    || (item.variant != null && !item.variant.isAvailable))) {
    return "Một món cố định trong combo đang tạm hết.";
  }

  const selected = new Map<string, number>();
  for (const id of optionIds) selected.set(id, (selected.get(id) ?? 0) + 1);
  const known = new Set<string>();
  for (const group of product.comboGroups) {
    const choices = comboGroupChoices(group);
    for (const choice of choices) known.add(choice.id);
    const count = choices.reduce((sum, choice) => sum + (selected.get(choice.id) ?? 0), 0);
    if (count < group.minSelect) {
      return "Nhóm “" + group.name + "” cần chọn ít nhất " + group.minSelect + " món.";
    }
    if (count > group.maxSelect) {
      return "Nhóm “" + group.name + "” chỉ được chọn tối đa " + group.maxSelect + " món.";
    }
    const unavailable = choices.find(choice =>
      (selected.get(choice.id) ?? 0) > 0 && !choice.isAvailable);
    if (unavailable) {
      return (unavailable.sourceType === "TOPPING" ? "Topping “" : "Món “")
        + unavailable.name + "” trong combo đang tạm hết.";
    }
  }
  if (optionIds.some(id => !known.has(id))) return "Lựa chọn combo đã thay đổi. Vui lòng chọn lại.";
  return null;
}

export function comboSelectionDeltaVnd(product: Product, optionIds: readonly string[]): number {
  if (product.kind !== "COMBO") return 0;
  const price = new Map(product.comboGroups.flatMap(group =>
    comboGroupChoices(group).map(choice => [choice.id, choice.priceDeltaVnd] as const)));
  return optionIds.reduce((sum, id) => sum + (price.get(id) ?? 0), 0);
}
