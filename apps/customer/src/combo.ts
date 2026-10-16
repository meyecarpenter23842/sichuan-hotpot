import type { Product } from "./api";

export function comboSelectionError(product: Product, optionIds: readonly string[]): string | null {
  if (optionIds.length > 30) return "Combo có quá nhiều lựa chọn.";
  if (product.kind !== "COMBO") {
    return optionIds.length ? "Món thường không nhận lựa chọn combo." : null;
  }
  if (product.comboFixedItems.length === 0 && product.comboGroups.length === 0) {
    return "Combo chưa được cửa hàng thiết lập đầy đủ.";
  }
  if (product.comboFixedItems.some(item =>
    item.quantity < 1 || item.childProduct.kind !== "STANDARD" || !item.childProduct.isAvailable)) {
    return "Một món cố định trong combo đang tạm hết.";
  }

  const selected = new Map<string, number>();
  for (const id of optionIds) selected.set(id, (selected.get(id) ?? 0) + 1);
  const known = new Set<string>();
  for (const group of product.comboGroups) {
    for (const option of group.options) known.add(option.id);
    const count = group.options.reduce((sum, option) => sum + (selected.get(option.id) ?? 0), 0);
    if (count < group.minSelect) {
      return "Nhóm “" + group.name + "” cần chọn ít nhất " + group.minSelect + " món.";
    }
    if (count > group.maxSelect) {
      return "Nhóm “" + group.name + "” chỉ được chọn tối đa " + group.maxSelect + " món.";
    }
    for (const option of group.options) {
      if ((selected.get(option.id) ?? 0) > 0
        && (!option.childProduct.isAvailable || option.childProduct.kind !== "STANDARD")) {
        return "Món “" + option.childProduct.name + "” trong combo đang tạm hết.";
      }
    }
  }
  if (optionIds.some(id => !known.has(id))) return "Lựa chọn combo đã thay đổi. Vui lòng chọn lại.";
  return null;
}

export function comboSelectionDeltaVnd(product: Product, optionIds: readonly string[]): number {
  if (product.kind !== "COMBO") return 0;
  const price = new Map(product.comboGroups.flatMap(group =>
    group.options.map(option => [option.id, option.priceDeltaVnd] as const)));
  return optionIds.reduce((sum, id) => sum + (price.get(id) ?? 0), 0);
}
