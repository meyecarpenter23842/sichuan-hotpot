import { Share } from "react-native";
import type { Bill } from "./pos-api";
import { money } from "./pos-api";

function displayOptions(snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const details = snapshot as Record<string, unknown>;
  const labels: string[] = [];
  if (Array.isArray(details.modifiers)) {
    const counts = new Map<string, number>();
    for (const option of details.modifiers) {
      if (!option || typeof option !== "object" || !("name" in option) ||
        typeof option.name !== "string") continue;
      counts.set(option.name, (counts.get(option.name) ?? 0) + 1);
    }
    if (counts.size) labels.push("Topping: " +
      [...counts].map(([name, count]) => count + " × " + name).join(", "));
  }
  if (Array.isArray(details.comboItems)) {
    for (const child of details.comboItems) {
      if (child && typeof child === "object" && "productName" in child &&
        typeof child.productName === "string") labels.push("+ " + child.productName);
    }
  }
  return labels;
}
/** Android system share sheet is supported. No claim about thermal printing hardware. */
export async function printDiningReceipt(bill: Bill): Promise<void> {
  const lines = [
    "LẨU TỨ XUYÊN · HÓA ĐƠN TẠI BÀN",
    bill.branch.name, "Bàn: " + bill.table.name + " (" + bill.table.code + ")",
    "Mở: " + new Date(bill.openedAt).toLocaleString("vi-VN"),
    ...(bill.closedAt ? ["Đóng: " + new Date(bill.closedAt).toLocaleString("vi-VN")] : []),
    "Trạng thái: " + bill.status, "----------------------------",
  ];
  for (const ticket of bill.tickets) {
    lines.push("Lượt #" + ticket.id.slice(0, 8) + " · " + ticket.status);
    for (const item of ticket.items) {
      lines.push(item.quantity + " × " + item.productName +
        (item.variantName ? " · " + item.variantName : "") +
        " : " + money(item.lineTotalVnd));
      lines.push(...displayOptions(item.selectionSnapshot));
    }
  }
  lines.push("----------------------------",
    "Tổng đã duyệt: " + money(bill.subtotalVnd),
    "Đã xác nhận thu: " + money(bill.paidVnd),
    "Còn cần thu: " + money(bill.dueVnd));
  for (const p of bill.payments) {
    lines.push((p.method === "CASH" ? "Tiền mặt" : "Chuyển khoản") + ": " +
      money(p.amountVnd) + " · " + p.status);
    if (p.status === "PENDING") lines.push("Chưa xác nhận nhận tiền");
  }
  lines.push("Bản chia sẻ để tham khảo, không xác nhận thanh toán ngân hàng.");
  await Share.share({ title: "Hóa đơn Lẩu Tứ Xuyên", message: lines.join("\n") });
}
