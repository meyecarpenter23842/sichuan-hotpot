import React, { useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { request } from "./api";
import { c } from "./theme";
import { Action } from "./ui";

export type DiningStaffBill = {
  id: string; tableId: string; status: "OPEN" | "CHECKOUT" | "CLOSED";
  openedAt: string; closedAt: string | null;
  table: { name: string; code: string }; branch: { name: string };
  subtotalVnd: number; paidVnd: number; dueVnd: number;
  tickets: { id: string; status: string; createdAt: string;
    items: { id: string; productName: string; variantName: string | null;
      quantity: number; lineTotalVnd: number }[] }[];
  payments: { id: string; method: "CASH" | "QR"; status: string;
    amountVnd: number; cashReceivedVnd: number | null;
    confirmedAt: string | null; confirmedById: string | null;
    qr: { imageUrl: string; accountName: string; accountNo: string;
      transferReference: string } | null }[];
};
type Target = { id: string; name: string; sessions: { id: string }[];
  isActive: boolean; needsCleaning: boolean };
const money = (v: number) => v.toLocaleString("vi-VN") + "đ";

export function AdminDiningSettlement({ token, branchId, sessionId, tableId, role,
  bill, tables, onChanged }: { token: string; branchId: string; sessionId: string;
  tableId: string; role: string; bill: DiningStaffBill; tables: Target[];
  onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [method, setMethod] = useState<"CASH" | "QR">("CASH");
  const [tender, setTender] = useState("");
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<{ id: string; amount: number;
    method: "CASH" | "QR"; cashReceivedVnd?: number } | null>(null);
  const lock = useRef(false);
  const path = "/dining/branches/" + branchId;
  const owner = ["OWNER", "MANAGER"].includes(role);
  const cashier = owner || role === "CASHIER";
  const transfer = owner || role === "WAITER";
  const change = Number.isSafeInteger(Number(tender)) && Number(tender) >= bill.dueVnd
    && tender.trim() !== "" ? Number(tender) - bill.dueVnd : null;
  const open = bill.status === "OPEN";
  const settled = bill.status === "CHECKOUT";
  useEffect(() => { setPendingKey(null); setReason(""); setError(""); setMessage(""); }, [sessionId]);
  const exec = (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    void fn().catch(err => setError(err instanceof Error ? err.message : "Không xử lý được hóa đơn."))
      .finally(() => { lock.current = false; setBusy(false); });
  };
  const submit = (url: string, body?: unknown, success?: string) => {
    exec(async () => {
      await request(path + url, token, "POST", body);
      setMessage(success ?? "Đã cập nhật giao dịch."); await onChanged();
    });
  };
  const pay = () => {
    if (!cashier || !settled || bill.dueVnd <= 0) return;
    if (method === "CASH" && change === null) {
      setError("Tiền mặt khách đưa phải đủ và là số nguyên VND."); return;
    }
    const draft = pendingKey ?? {
      id: "pay-" + Date.now() + "-" + Math.random().toString(36).slice(2),
      amount: bill.dueVnd, method,
      ...(method === "CASH" ? { cashReceivedVnd: Number(tender) } : {}),
    };
    setPendingKey(draft);
    exec(async () => {
      await request(path + "/sessions/" + sessionId + "/payments", token, "POST", {
        idempotencyKey: draft.id, method: draft.method, amountVnd: draft.amount,
        ...(draft.cashReceivedVnd === undefined ? {} : { cashReceivedVnd: draft.cashReceivedVnd }),
      });
      setPendingKey(null);
      setMessage(method === "QR" ? "Đã tạo QR, chưa nhận tiền. Cần xác nhận ngân hàng." :
        "Đã ghi nhận tiền mặt.");
      await onChanged();
    });
  };
  const print = () => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const page = window.open("", "_blank", "width=520,height=720");
    if (!page) { setError("Trình duyệt chặn cửa sổ xem/in hóa đơn."); return; }
    page.opener = null;
    page.document.open();
    page.document.write("<!doctype html><html><head><meta charset='utf-8'><title>Hóa đơn bàn</title><style>body{font-family:Arial,sans-serif;max-width:400px;margin:24px auto;color:#322523}p{font-size:12px}div{padding:4px 0;border-bottom:1px dashed #ddd}.total{font-weight:bold;font-size:16px}@media print{body{margin:0}}</style></head><body></body></html>");
    page.document.close();
    const add = (tag: string, t: string, cls?: string) => {
      const e = page.document.createElement(tag); e.textContent = t;
      if (cls) e.className = cls; page.document.body.appendChild(e);
    };
    add("h2", "LẨU TỨ XUYÊN — HÓA ĐƠN BÀN");
    add("p", bill.branch.name + " / " + bill.table.name + " (" + bill.table.code + ")");
    add("p", "Mở: " + new Date(bill.openedAt).toLocaleString("vi-VN"));
    if (bill.closedAt) add("p", "Đóng: " + new Date(bill.closedAt).toLocaleString("vi-VN"));
    bill.tickets.forEach(t => {
      add("p", "Lượt #" + t.id.slice(0, 8) + " • " + t.status);
      t.items.forEach(i => add("div", i.quantity + " × " + i.productName +
        (i.variantName ? " · " + i.variantName : "") + " — " + money(i.lineTotalVnd)));
    });
    add("div", "Tổng: " + money(bill.subtotalVnd), "total");
    add("div", "Đã xác nhận thu: " + money(bill.paidVnd));
    add("div", "Còn thu: " + money(bill.dueVnd), "total");
    bill.payments.forEach(p => {
      add("p", p.method + " · " + money(p.amountVnd) + " · " + p.status +
        (p.method === "CASH" && p.cashReceivedVnd !== null ?
          " · Khách đưa " + money(p.cashReceivedVnd) +
          " · Thối " + money(p.cashReceivedVnd - p.amountVnd) : "") +
        (p.confirmedAt ? " · " + new Date(p.confirmedAt).toLocaleString("vi-VN") +
          " · NV #" + (p.confirmedById?.slice(0, 8) ?? "") : ""));
    });
    add("p", "Chỉ là bản xem/in hóa đơn; không phải bằng chứng ngân hàng.");
    page.focus(); page.print();
  };

  return <View style={s.root}>
    <Text style={s.heading}>Thanh toán & quản lý phiên</Text>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {!!message && <Text accessibilityRole="alert" style={s.success}>{message}</Text>}
    {open && <>
      <Action disabled={busy} label="Chốt hóa đơn" onPress={() =>
        submit("/sessions/" + sessionId + "/checkout", undefined,
          "Đã chốt hóa đơn. Không thể thêm lượt món.")}/>
      {transfer && <>
        <Text style={s.note}>Chuyển sang bàn trống, đã dọn:</Text>
        <View style={s.row}>{tables.filter(t => t.id !== tableId && t.isActive &&
          !t.needsCleaning && !t.sessions.length).map(t =>
          <Pressable key={t.id} accessibilityRole="button"
            accessibilityState={{ selected: target === t.id }}
            onPress={() => setTarget(t.id)} style={[s.chip, target === t.id && s.chipOn]}>
            <Text style={s.chipText}>{t.name}</Text></Pressable>)}</View>
        <Action secondary disabled={busy || !target} label="Chuyển bàn" onPress={() => {
          if (target) submit("/sessions/" + sessionId + "/transfer",
            { expectedTableId: tableId, targetTableId: target },
            "Đã chuyển bàn, hóa đơn và lịch sử không đổi.");
        }}/>
      </>}
      {owner && <>
        <TextInput style={s.input} value={reason} onChangeText={setReason}
          maxLength={500} placeholder="Lý do hủy/hoàn tiền" accessibilityLabel="Lý do hủy hoặc hoàn tiền"/>
        {bill.tickets.filter(t => t.status === "APPROVED").map(t =>
          <Action key={t.id} dangerous disabled={busy || reason.trim().length < 3}
            label={"Hủy lượt #" + t.id.slice(0, 8)} onPress={() =>
              submit("/tickets/" + t.id + "/void", { reason: reason.trim() },
                "Đã lưu lý do hủy và lịch sử món.")}/>)}
      </>}
    </>}
    {settled && <>
      <Text style={s.note}>Còn thu: {money(bill.dueVnd)} • Đã thu: {money(bill.paidVnd)}</Text>
      {cashier && bill.dueVnd > 0 && <>
        <View style={s.row}>{(["CASH","QR"] as const).map(x =>
          <Pressable key={x} style={[s.chip, method === x && s.chipOn]} onPress={() => {
            if (!pendingKey) setMethod(x);
          }} accessibilityRole="button">
            <Text style={s.chipText}>{x === "CASH" ? "Tiền mặt" : "QR chuyển khoản"}</Text>
          </Pressable>)}</View>
        {method === "CASH" && <>
          <TextInput style={s.input} keyboardType="number-pad" value={tender}
            onChangeText={setTender} placeholder="Tiền khách đưa (VND)"
            accessibilityLabel="Tiền khách đưa"/>
          {change !== null && <Text style={s.success}>Tiền thối: {money(change)}</Text>}
        </>}
        <Action disabled={busy || (method === "CASH" && change === null)}
          label={pendingKey ? "Thử lại giao dịch cũ" : method === "CASH" ?
            "Xác nhận thu tiền mặt" : "Tạo QR chuyển khoản"}
          onPress={pay}/>
        {pendingKey && <Text style={s.error}>Chưa rõ kết quả gửi, giữ nguyên mã giao dịch để tránh trùng.</Text>}
      </>}
      {owner && <TextInput style={s.input} value={reason} onChangeText={setReason}
        maxLength={500} placeholder="Lý do hoàn tiền/hủy QR"
        accessibilityLabel="Lý do hoàn tiền hoặc hủy QR"/>}
      {bill.payments.map(p => <View key={p.id} style={s.payment}>
        <Text style={s.note}>{p.method} • {money(p.amountVnd)} • {p.status}</Text>
        {p.status === "PENDING" && p.method === "QR" && <>
          {p.qr && <><Image source={{ uri: p.qr.imageUrl }} style={s.qr} resizeMode="contain"/>
            <Text selectable style={s.note}>{p.qr.accountName} · {p.qr.accountNo}</Text>
            <Text selectable style={s.note}>Nội dung CK: {p.qr.transferReference}</Text></>}
          <Text style={s.error}>Chưa xác nhận ngân hàng nhận tiền.</Text>
          {cashier && <Action label="Xác nhận đã nhận CK tại ngân hàng" disabled={busy}
            onPress={() => submit("/payments/" + p.id + "/confirm", undefined,
              "Đã xác nhận thủ công tiền chuyển khoản.")}/>}
          {owner && <Action dangerous label="Hủy QR này"
            disabled={busy || reason.trim().length < 3} onPress={() =>
              submit("/payments/" + p.id + "/void", { reason: reason.trim() })}/>}
        </>}
        {owner && p.status === "CONFIRMED" && <Action dangerous label="Hoàn toàn bộ khoản thu"
          disabled={busy || reason.trim().length < 3} onPress={() =>
            submit("/payments/" + p.id + "/refund", { reason: reason.trim() })}/>}
      </View>)}
      {cashier && bill.dueVnd === 0 && !bill.payments.some(p => p.status === "PENDING") &&
        <Action label="Đã thanh toán • Đóng bàn" disabled={busy} onPress={() =>
          submit("/sessions/" + sessionId + "/close", undefined,
            "Đã đóng phiên. Bàn chuyển sang chờ dọn.")}/>}
    </>}
    {Platform.OS === "web" && <Action secondary label="Xem/In hóa đơn"
      onPress={print}/>}
  </View>;
}
const s = StyleSheet.create({
  root: { gap: 11, paddingTop: 12, borderTopWidth: 1, borderColor: c.line },
  heading: { color: c.ink, fontSize: 15, fontWeight: "900" },
  note: { color: c.secondary, fontSize: 12, lineHeight: 18 },
  error: { color: c.red, fontSize: 12, lineHeight: 18 },
  success: { color: "#287C5C", fontSize: 12, lineHeight: 18 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 10, borderColor: c.line,
    color: c.ink, backgroundColor: c.white, paddingHorizontal: 12 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { minHeight: 44, borderWidth: 1, borderRadius: 9,
    borderColor: c.line, paddingHorizontal: 12, justifyContent: "center" },
  chipOn: { backgroundColor: "#FCE6E6", borderColor: c.red },
  chipText: { fontSize: 12, color: c.ink, fontWeight: "700" },
  payment: { padding: 12, gap: 9, borderWidth: 1, borderColor: c.line,
    borderRadius: 11, backgroundColor: c.white },
  qr: { width: 225, height: 225, alignSelf: "center" },
});
