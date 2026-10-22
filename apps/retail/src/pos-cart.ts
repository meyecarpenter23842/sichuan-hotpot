import type { CartLine, ComboGroup, ItemInput, Product } from "./pos-api";

export type Selection = { variantId: string | null; modifiers: Record<string, string[]>;
  combo: Record<string, string[]>; quantity: number; note: string };
export const emptySelection = (): Selection =>
  ({ variantId: null, modifiers: {}, combo: {}, quantity: 1, note: "" });

export function isSelectionValid(product: Product, choice: Selection): string | null {
  if (!product.isAvailable) return "Món hiện đã hết hàng.";
  if (choice.quantity < 1 || choice.quantity > 99 || !Number.isInteger(choice.quantity))
    return "Số lượng phải từ 1 đến 99.";
  if (choice.note.length > 500) return "Ghi chú quá dài.";
  if (choice.variantId && !product.variants.some(v => v.id === choice.variantId && v.isAvailable))
    return "Size đã hết hoặc không còn hợp lệ.";
  for (const group of product.modifierGroups) {
    const enabled = group.options.filter(o => o.isAvailable);
    const selection = choice.modifiers[group.id] ?? [];
    if (selection.length !== new Set(selection).size ||
      selection.length < group.minSelect || selection.length > group.maxSelect ||
      selection.some(id => !enabled.some(o => o.id === id))) {
      return "Vui lòng chọn " + group.minSelect + "–" + group.maxSelect +
        " tùy chọn hợp lệ trong nhóm " + group.name + ".";
    }
  }
  for (const group of product.comboGroups) {
    const ids = choice.combo[group.id] ?? [];
    const available = usableComboOptions(group);
    if (ids.length !== new Set(ids).size || ids.length < group.minSelect ||
      ids.length > group.maxSelect || ids.some(id => !available.some(o => o.id === id))) {
      return "Vui lòng chọn " + group.minSelect + "–" + group.maxSelect +
        " mục hợp lệ trong combo " + group.name + ".";
    }
  }
  return null;
}
export function usableComboOptions(group: ComboGroup) {
  return [
    ...group.options.filter(o => o.childProduct.isAvailable && (o.variant == null || o.variant.isAvailable))
      .map(o => ({ id: o.id, label: o.childProduct.name + (o.variant ? " • " + o.variant.name : ""),
        priceDeltaVnd: o.priceDeltaVnd + (o.variant?.priceDeltaVnd ?? 0) })),
    ...group.modifierOptions.filter(o => o.modifierOption.isAvailable && o.modifierOption.group.isAvailable)
      .map(o => ({ id: o.id, label: o.modifierOption.name, priceDeltaVnd: o.priceDeltaVnd })),
  ];
}
export function lineFromSelection(product: Product, choice: Selection, uid: string): CartLine {
  const issue = isSelectionValid(product, choice);
  if (issue) throw new Error(issue);
  const variant = product.variants.find(v => v.id === choice.variantId);
  const modifierIds = product.modifierGroups.flatMap(g => choice.modifiers[g.id] ?? []);
  const comboOptionIds = product.comboGroups.flatMap(g => choice.combo[g.id] ?? []);
  const delta = modifierIds.reduce((sum, id) =>
    sum + product.modifierGroups.flatMap(g => g.options).find(o => o.id === id)!.priceDeltaVnd, 0);
  const comboDelta = comboOptionIds.reduce((sum, id) =>
    sum + product.comboGroups.flatMap(usableComboOptions).find(o => o.id === id)!.priceDeltaVnd, 0);
  const estimated = (product.priceVnd + (variant?.priceDeltaVnd ?? 0) + delta + comboDelta) * choice.quantity;
  const item: ItemInput = { productId: product.id, variantId: choice.variantId,
    modifierIds, comboOptionIds, quantity: choice.quantity, note: choice.note.trim() };
  return { id: uid, name: product.name, variantName: variant?.name,
    previewVnd: estimated, item };
}
/** Topping quantities are encoded as repeated option IDs: validated and priced by
 * the existing server contract, with a maximum of 30 selections per group.
 * This never multiplies the whole dish quantity or sends client prices. */
export function setOptionQuantity(current: string[], id: string, desired: number, max: number): string[] {
  if (!Number.isSafeInteger(desired) || desired < 0 || desired > 30
      || !Number.isSafeInteger(max) || max < 0 || max > 30) return current;
  const others = current.filter(value => value !== id);
  if (others.length + desired > max) return current;
  return [...others, ...Array(desired).fill(id)];
}
export function optionQuantity(current: string[], id: string): number {
  return current.filter(value => value === id).length;
}
/** Describe the actual selected options, including repeated topping IDs. */
export function cartSelectionLabels(product: Product | undefined, item: ItemInput): string[] {
  if (!product) return item.modifierIds.length ? ["Topping đã chọn: "+item.modifierIds.length+" phần"] : [];
  const lines: string[] = [];
  for (const group of product.modifierGroups) {
    const selected = group.options.map(option => {
      const quantity = optionQuantity(item.modifierIds, option.id);
      return quantity > 0 ? quantity+" × "+option.name : null;
    }).filter((label): label is string => label !== null);
    if (selected.length) lines.push(group.name+": "+selected.join(", "));
  }
  for (const group of product.comboGroups) {
    const selected = usableComboOptions(group).map(option => {
      const quantity = optionQuantity(item.comboOptionIds, option.id);
      return quantity > 0 ? quantity+" × "+option.label : null;
    }).filter((label): label is string => label !== null);
    if (selected.length) lines.push(group.name+": "+selected.join(", "));
  }
  return lines;
}
export function toggleMultiple(current: string[], value: string, max: number) {
  if (current.includes(value)) return current.filter(id => id !== value);
  if (current.length >= max) return current;
  return [...current, value];
}
export function clientKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "retail-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}
