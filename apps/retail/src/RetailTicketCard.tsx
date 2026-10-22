import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { money, productImage, type Menu, type Ticket, type TicketItem } from "./pos-api";

// The server owns ticket states, amounts, and product snapshots. Never infer
// approval or payment from a local cart or from an image/catalogue match.
export const kitchenStates = ["APPROVED", "PREPARING", "READY", "SERVED"] as const;
export function ticketGroup(status: string): "pending" | "accepted" | "excluded" {
  if (status === "PENDING_APPROVAL") return "pending";
  if (kitchenStates.some(s => s === status)) return "accepted";
  return "excluded";
}
export function ticketStatus(status: string) {
  const labels: Record<string, string> = {
    PENDING_APPROVAL: "Chờ xác nhận",
    APPROVED: "Đã gửi Bếp",
    PREPARING: "Bếp đang làm",
    READY: "Sẵn sàng",
    SERVED: "Đã phục vụ",
    REJECTED: "Đã từ chối",
    CANCELED: "Đã hủy",
  };
  return labels[status] ?? status;
}

/** Saved ticket snapshots survive subsequent edits/deletion in the catalog.
 * Duplicate option IDs represent topping quantity, not duplicate tickets. */
export function snapshotLabels(snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const record = snapshot as Record<string, unknown>;
  const result: string[] = [];
  if (Array.isArray(record.modifiers)) {
    const modifiers = new Map<string, { name: string; quantity: number }>();
    for (const candidate of record.modifiers) {
      if (!candidate || typeof candidate !== "object" || !("name" in candidate)
          || typeof candidate.name !== "string" || !candidate.name) continue;
      const name = candidate.name;
      const key = "optionId" in candidate && typeof candidate.optionId === "string"
        ? candidate.optionId : name;
      const current = modifiers.get(key);
      modifiers.set(key, { name, quantity: (current?.quantity ?? 0) + 1 });
    }
    for (const option of modifiers.values()) {
      result.push("Topping: " + option.quantity + " × " + option.name);
    }
  }
  if (Array.isArray(record.comboItems)) for (const candidate of record.comboItems) {
    if (!candidate || typeof candidate !== "object" || !("productName" in candidate)
        || typeof candidate.productName !== "string" || !candidate.productName) continue;
    const units = "quantity" in candidate && typeof candidate.quantity === "number"
      && Number.isSafeInteger(candidate.quantity) && candidate.quantity > 0
        ? candidate.quantity : 1;
    result.push("Combo: " + units + " × " + candidate.productName);
  }
  if (typeof record.note === "string" && record.note) result.push("Ghi chú: " + record.note);
  return result;
}
function TicketProduct({ item, catalog }: { item: TicketItem; catalog: Menu | null }) {
  // Use the stable server product id; historical items with removed products get
  // a placeholder rather than a possibly incorrect image matched by name.
  const product = catalog?.categories.flatMap(c => c.products).find(p => p.id === item.productId);
  const photo = product?.imageKey ? productImage(product.imageKey) : null;
  return <View style={s.item}>
    {photo ? <Image source={{ uri: photo }} resizeMode="cover" style={s.photo}/> :
      <View style={s.placeholder}><Text style={s.placeholderText}>🍲</Text></View>}
    <View style={s.itemMain}>
      <Text style={s.itemName} numberOfLines={2}>{item.productName}</Text>
      {!!item.variantName && <Text style={s.detail} numberOfLines={1}>{item.variantName}</Text>}
      <Text style={s.detail}>Số lượng: {item.quantity}</Text>
      {snapshotLabels(item.selectionSnapshot).map((description, index) =>
        <Text key={index} style={s.modifierDetail}>{description}</Text>)}
    </View>
    <Text style={s.price}>{money(item.lineTotalVnd)}</Text>
  </View>;
}

export function RetailTicketCard({ ticket, catalog, actions }: {
  ticket: Ticket; catalog: Menu | null; actions?: React.ReactNode;
}) {
  const group = ticketGroup(ticket.status);
  return <View testID={"retail-ticket-" + ticket.id} style={[s.card, group === "pending" && s.pendingCard]}>
    <View style={s.top}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.meta} numberOfLines={1}>
          {ticket.source === "QR" ? "Khách quét QR" : "Nhân viên"} · {new Date(ticket.createdAt)
            .toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
        </Text>
      </View>
      <View style={[s.statusPill, group === "pending" ? s.pendingPill :
        group === "accepted" ? s.acceptedPill : s.excludedPill]}>
        <Text style={[s.statusText, group === "pending" ? s.pendingText :
          group === "accepted" ? s.acceptedText : s.excludedText]}>{ticketStatus(ticket.status)}</Text>
      </View>
    </View>
    {ticket.items.map(item => <TicketProduct key={item.id} item={item} catalog={catalog}/>)}
    {!!ticket.customerNote && <Text style={s.note}>Ghi chú: {ticket.customerNote}</Text>}
    {actions}
  </View>;
}
const s = StyleSheet.create({
  card: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E9E1DA",
    borderRadius: 12, padding: 10, gap: 8 },
  pendingCard: { borderColor: "#F0B0AF", backgroundColor: "#FFF8F7" },
  top: { flexDirection: "row", alignItems: "center", gap: 7 },
  meta: { color: "#7B6A65", fontSize: 11, fontWeight: "700" },
  statusPill: { paddingVertical: 5, paddingHorizontal: 8, borderRadius: 7 },
  statusText: { fontWeight: "800", fontSize: 10 },
  pendingPill: { backgroundColor: "#FBE0E0" },
  pendingText: { color: "#A3202D" },
  acceptedPill: { backgroundColor: "#E1F5E8" },
  acceptedText: { color: "#216C47" },
  excludedPill: { backgroundColor: "#F0EEEC" },
  excludedText: { color: "#6C6761" },
  item: { flexDirection: "row", alignItems: "center", gap: 9, minWidth: 0 },
  photo: { width: 48, height: 48, borderRadius: 8, backgroundColor: "#F3EBE5" },
  placeholder: { width: 48, height: 48, borderRadius: 8, backgroundColor: "#F4EAE3",
    alignItems: "center", justifyContent: "center" },
  placeholderText: { fontSize: 22 },
  itemMain: { flex: 1, minWidth: 0, gap: 2 },
  itemName: { color: "#362420", fontWeight: "800", fontSize: 12 },
  detail: { color: "#796C67", fontSize: 11 },
  modifierDetail: { color: "#8D2734", fontSize: 11, lineHeight: 16, fontWeight: "700" },
  price: { color: "#76202A", fontWeight: "900", fontSize: 12 },
  note: { padding: 8, backgroundColor: "#FFF2E4", borderRadius: 8,
    fontSize: 11, lineHeight: 16, color: "#694D32" },
});
