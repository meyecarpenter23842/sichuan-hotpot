import type { Bill } from "./pos-api";
import { money } from "./pos-api";

/** Read-only browser print preview. No silent printing or thermal-printer claim. */
export function printDiningReceipt(bill: Bill): void {
  if (typeof window === "undefined") return;
  const page = window.open("", "_blank", "width=540,height=780");
  if (!page) throw new Error("Trình duyệt chặn cửa sổ in. Hãy cho phép popup rồi thử lại.");
  page.opener = null;
  page.document.open();
  page.document.write("<!doctype html><html><head><meta charset='utf-8'><title>Hóa đơn tại bàn</title><style>body{font-family:Arial,sans-serif;max-width:380px;margin:24px auto;padding:12px;color:#292322}h2{text-align:center;font-size:19px}p{margin:5px 0;font-size:12px;overflow-wrap:anywhere}.line{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dashed #ddd;padding:5px 0}.total{font-weight:bold;font-size:15px}hr{border:0;border-top:1px dashed #bbb;margin:12px 0}@media print{body{max-width:none;margin:0;padding:0}}</style></head><body></body></html>");
  page.document.close();
  const body = page.document.body;
  const add = (tag: string, value: string, className = "") => {
    const el = page.document.createElement(tag); el.textContent = value;
    if (className) el.className = className;
    body.appendChild(el); return el;
  };
  const row = (left: string, right: string, extra = "") => {
    const div = page.document.createElement("div"); div.className = "line " + extra;
    const a = page.document.createElement("span"); a.textContent = left;
    const b = page.document.createElement("span"); b.textContent = right;
    div.append(a, b); body.appendChild(div);
  };
  add("h2", "LẨU TỨ XUYÊN · HÓA ĐƠN");
  add("p", bill.branch?.name ?? "Cửa hàng");
  add("p", "Bàn: " + (bill.table?.name ?? "") + " (" + (bill.table?.code ?? "") + ")");
  add("p", "Mở: " + new Date(bill.openedAt).toLocaleString("vi-VN"));
  if (bill.closedAt) add("p", "Đóng: " + new Date(bill.closedAt).toLocaleString("vi-VN"));
  add("p", "Trạng thái: " + bill.status);
  body.appendChild(page.document.createElement("hr"));
  bill.tickets.forEach(ticket => {
    add("p", "Lượt #" + ticket.id.slice(0, 8) + " • " +
      new Date(ticket.createdAt).toLocaleTimeString("vi-VN") + " • " + ticket.status);
    ticket.items.forEach(item => {
      row(item.quantity + " × " + item.productName +
        (item.variantName ? " · " + item.variantName : ""), money(item.lineTotalVnd));
      const snap = item.selectionSnapshot;
      if (snap && typeof snap === "object" && !Array.isArray(snap)) {
        const selections = snap as Record<string, unknown>;
        if (Array.isArray(selections.modifiers)) {
          const counts = new Map<string, number>();
          for (const x of selections.modifiers) {
            const name = x && typeof x === "object" && "name" in x && typeof x.name === "string"
              ? x.name : "";
            if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
          }
          if (counts.size) add("p", "Topping: " +
            [...counts].map(([name, count]) => count + " × " + name).join(", "));
        }
        if (Array.isArray(selections.comboItems)) for (const child of selections.comboItems) {
          if (!child || typeof child !== "object") continue;
          const itemName = "productName" in child && typeof child.productName === "string"
            ? child.productName : "";
          if (itemName) add("p", "  + " + itemName);
        }
      }
    });
  });
  body.appendChild(page.document.createElement("hr"));
  row("Tổng đã duyệt", money(bill.subtotalVnd), "total");
  row("Đã xác nhận thu", money(bill.paidVnd));
  row("Còn cần thu", money(bill.dueVnd), "total");
  bill.payments.forEach(p => {
    add("p", (p.method === "CASH" ? "Tiền mặt" : "Chuyển khoản") + " • " +
      money(p.amountVnd) + " • " + p.status);
    if (p.method === "CASH" && p.cashReceivedVnd !== null) {
      add("p", "Khách đưa: " + money(p.cashReceivedVnd) +
        " · Thối: " + money(p.cashReceivedVnd - p.amountVnd));
    }
    if (p.confirmedAt) add("p", "Xác nhận: " + new Date(p.confirmedAt).toLocaleString("vi-VN") +
      " • NV #" + (p.confirmedById?.slice(0, 8) ?? "—"));
    if (p.status === "PENDING") add("p", "Chưa xác nhận nhận tiền");
  });
  add("p", "Bản xem trước để in. Không phải bằng chứng chuyển khoản.");
  page.focus(); page.print();
}
