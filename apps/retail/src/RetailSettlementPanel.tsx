import React, { useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api, branchPath, money, type Bill, type Table } from "./pos-api";
import { clientKey } from "./pos-cart";
import { printDiningReceipt } from "./dining-receipt";
import { loadFrozenPayment, writeFrozenPayment } from "./retail-recovery";

const C = { ink: "#322523", red: "#942B35", muted: "#80716C", border: "#EAE1DA",
  paper: "#FFFFFF", cream: "#FAF7F3", green: "#287C5C" };
type Pay = { paymentId: string; amountVnd: number; status: string; replayed: boolean;
  qr: { bankBin: string; accountNo: string; accountName: string;
    transferReference: string; imageUrl: string; amountVnd: number } | null };

export function RetailSettlementPanel({ branchId, sessionId, table, tables, role,
  bill, onChanged }: { branchId: string; sessionId: string; table: Table; tables: Table[];
  role: string; bill: Bill | null; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [method, setMethod] = useState<"CASH" | "QR">("CASH");
  const [cash, setCash] = useState("");
  const [reason, setReason] = useState("");
  const [targetId, setTargetId] = useState("");
  const [restoringPayment, setRestoringPayment] = useState(true);
  const [paymentRecoveryFailed, setPaymentRecoveryFailed] = useState(false);
  const [pending, setPending] = useState<{
    key: string; sessionId: string; method: "CASH" | "QR";
    amountVnd: number; cashReceivedVnd?: number;
  } | null>(null);
  const lock = useRef(false);
  const admin = ["OWNER", "MANAGER"].includes(role);
  const cashier = admin || role === "CASHIER";
  const canTransfer = admin || role === "WAITER";
  const path = branchPath(branchId);
  const cleanTargets = tables.filter(t => t.id !== table.id && t.isActive
    && !t.needsCleaning && !t.sessions.length);
  const due = bill?.dueVnd ?? 0;
  const tender = Number(cash);
  const change = Number.isSafeInteger(tender) && tender >= due ? tender - due : null;

  useEffect(() => {
    let mounted = true;
    setRestoringPayment(true); setPaymentRecoveryFailed(false);
    setPending(null); setError(""); setInfo(""); setCash(""); setReason(""); setTargetId("");
    void loadFrozenPayment(branchId, sessionId).then(saved => {
      if (mounted && saved) {
        setPending(saved);
        setMethod(saved.method);
        if (saved.cashReceivedVnd !== undefined) setCash(String(saved.cashReceivedVnd));
      }
    }).catch(() => {
      if (mounted) {
        setPaymentRecoveryFailed(true);
        setError("Phiếu thu tiền đã lưu không đọc được. Cần xác minh trước khi tạo phiếu khác.");
      }
    }).finally(() => { if (mounted) setRestoringPayment(false); });
    return () => { mounted = false; };
  }, [branchId, sessionId]);

  const run = (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setInfo("");
    void action().catch(err => setError(err instanceof Error ? err.message : "Thao tác thất bại."))
      .finally(() => { lock.current = false; setBusy(false); });
  };

  const pay = () => {
    if (restoringPayment || paymentRecoveryFailed || !cashier || due <= 0 || !bill || bill.status !== "CHECKOUT") return;
    const received = method === "CASH" ? tender : undefined;
    if (method === "CASH" && (!Number.isSafeInteger(received) ||
      received! < due || received! > 2_000_000_000)) {
      setError("Tiền khách đưa phải là số nguyên VND và không ít hơn số cần thu."); return;
    }
    // Retain the same idempotency key and exact amount if the connection becomes uncertain.
    const draft = pending ?? {
      key: clientKey(), sessionId, method, amountVnd: due,
      ...(received !== undefined ? { cashReceivedVnd: received } : {}),
    };
    if (draft.sessionId !== sessionId) { setError("Phiếu thuộc bàn khác."); return; }
    setPending(draft);
    run(async () => {
      // An uncertain response must reuse the same settlement key across app restarts.
      await writeFrozenPayment(branchId, sessionId, draft);
      const result = await api<Pay>(path + "/sessions/" + sessionId + "/payments", {
        method: "POST", body: {
          idempotencyKey: draft.key, method: draft.method, amountVnd: draft.amountVnd,
          ...(draft.cashReceivedVnd === undefined ? {} : { cashReceivedVnd: draft.cashReceivedVnd }),
        },
      });
      await writeFrozenPayment(branchId, sessionId, null);
      setPending(null);
      setInfo(result.status === "PENDING"
        ? "Đã tạo QR chuyển khoản. CHƯA thu tiền; thu ngân phải kiểm tra giao dịch ngân hàng và xác nhận."
        : "Đã ghi nhận tiền mặt. " + (result.replayed ? "(Phiếu đã tồn tại)" : "Không ghi trùng."));
      await onChanged();
    });
  };

  const action = (url: string, body?: unknown, success?: string) =>
    run(async () => {
      await api(path + url, { method: "POST", ...(body === undefined ? {} : { body }) });
      setInfo(success ?? "Đã cập nhật."); await onChanged();
    });

  return <View style={s.root}>
    <Text style={s.title}>Thanh toán & kết thúc bàn</Text>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {!!info && <Text accessibilityRole="alert" style={s.info}>{info}</Text>}
    {bill?.status === "OPEN" && <>
      <Text style={s.help}>Chốt hóa đơn khi không còn món QR chờ duyệt. Sau khi chốt không gọi thêm món.</Text>
      <Button label="Chốt hóa đơn • Chờ thanh toán" disabled={busy || !bill || !sessionId}
        onPress={() => action("/sessions/" + sessionId + "/checkout", undefined, "Đã chốt hóa đơn.")}/>
      {canTransfer && <>
        <Text style={s.label}>Chuyển sang bàn trống</Text>
        <View style={s.row}>{cleanTargets.map(t => <Pressable key={t.id}
          accessibilityRole="button" accessibilityState={{ selected: targetId === t.id }}
          onPress={() => setTargetId(t.id)}
          style={[s.chip, targetId === t.id && s.chipOn]}>
          <Text style={[s.chipText, targetId === t.id && s.chipTextOn]}>{t.name}</Text></Pressable>)}</View>
        <Button label="Chuyển bàn" disabled={busy || !targetId} onPress={() =>
          action("/sessions/" + sessionId + "/transfer", {
            expectedTableId: table.id, targetTableId: targetId,
          }, "Đã chuyển bàn; QR cũ của phiên bị thu hồi.")}/>
      </>}
      {admin && <>
        <Text style={s.label}>Hủy phiếu mới được duyệt (chưa làm bếp)</Text>
        <TextInput value={reason} onChangeText={setReason} style={s.input} maxLength={500}
          placeholder="Nhập lý do hủy có audit" accessibilityLabel="Lý do hủy hoặc hoàn tiền"/>
        {bill?.tickets.filter(t => t.status === "APPROVED").map(t =>
          <Button key={t.id} label={"Hủy lượt #" + t.id.slice(0, 8)}
            disabled={busy || reason.trim().length < 3}
            onPress={() => action("/tickets/" + t.id + "/void", { reason: reason.trim() },
              "Đã hủy lượt gọi, giữ lịch sử và audit.")}/>)}
      </>}
    </>}
    {bill?.status === "CHECKOUT" && <>
      <Text style={s.help}>Cần thu {money(due)} • Đã xác nhận {money(bill.paidVnd)}</Text>
      {cashier && due > 0 && <>
        <View style={s.row}>
          {(["CASH", "QR"] as const).map(m => <Pressable key={m}
            accessibilityRole="button" accessibilityState={{ selected: method === m }}
            style={[s.chip, method === m && s.chipOn]}
            onPress={() => { if (!pending) setMethod(m); }}>
            <Text style={[s.chipText, method === m && s.chipTextOn]}>
              {m === "CASH" ? "Tiền mặt" : "QR chuyển khoản"}</Text>
          </Pressable>)}
        </View>
        {method === "CASH" && <><Text style={s.label}>Tiền khách đưa (VND)</Text>
          <TextInput style={s.input} value={cash} onChangeText={setCash}
            keyboardType="number-pad" placeholder="VD: 500000"
            accessibilityLabel="Tiền mặt khách đưa"/>
          {change !== null && <Text style={s.info}>Tiền trả lại: {money(change)}</Text>}
        </>}
        <Button label={pending ? "Gửi lại phiếu thanh toán cũ" :
          method === "CASH" ? "Ghi nhận tiền mặt" : "Tạo QR chờ xác nhận"}
          disabled={busy || restoringPayment || paymentRecoveryFailed || (method === "CASH" && change === null)} onPress={pay}/>
        {!!pending && <Text style={s.help}>Chưa rõ kết quả gửi. Giữ nguyên mã thanh toán khi thử lại, không tạo phiếu mới.</Text>}
      </>}
      {bill.payments.map(p => <View key={p.id} style={s.payment}>
        <Text style={s.help}>{p.method === "CASH" ? "Tiền mặt" : "Chuyển khoản"} · {money(p.amountVnd)} · {p.status}</Text>
        {!!p.confirmedAt && <Text style={s.help}>Thu lúc {new Date(p.confirmedAt).toLocaleString("vi-VN")} · Nhân viên #{p.confirmedById?.slice(0, 8)}</Text>}
        {p.status === "PENDING" && p.method === "QR" && <>
          {p.qr && <><Image source={{ uri: p.qr.imageUrl }} style={s.qr} resizeMode="contain" />
            <Text selectable style={s.label}>{p.qr.accountName} · {p.qr.accountNo}</Text>
            <Text selectable style={s.help}>Nội dung CK: {p.qr.transferReference}</Text></>}
          <Text style={s.error}>QR chỉ là yêu cầu. Chưa xác nhận tiền ngân hàng thực nhận.</Text>
          {cashier && <Button label="Đã kiểm tra ngân hàng • Xác nhận thu"
            disabled={busy} onPress={() => action("/payments/" + p.id + "/confirm", undefined,
              "Đã xác nhận nhận tiền chuyển khoản trên ngân hàng.")}/>}
          {admin && <Button label="Hủy QR chờ" disabled={busy || reason.trim().length < 3}
            onPress={() => action("/payments/" + p.id + "/void", { reason: reason.trim() },
              "Đã thu hồi yêu cầu chuyển khoản.")}/>}
        </>}
        {admin && p.status === "CONFIRMED" && <Button label="Hoàn toàn bộ khoản thu"
          disabled={busy || reason.trim().length < 3} onPress={() =>
            action("/payments/" + p.id + "/refund", { reason: reason.trim() },
              "Đã ghi nhận hoàn toàn bộ khoản thu, có nhật ký.")}/>}
      </View>)}
      {admin && <TextInput value={reason} onChangeText={setReason} style={s.input}
        maxLength={500} placeholder="Lý do hoàn tiền / hủy QR"
        accessibilityLabel="Lý do hoàn tiền hoặc hủy QR"/>}
      {due === 0 && !bill.payments.some(p => p.status === "PENDING") &&
        <Button label="Đã thanh toán • Đóng bàn" disabled={busy || !cashier}
          onPress={() => action("/sessions/" + sessionId + "/close", undefined,
            "Bàn đã đóng và chuyển sang chờ dọn.")}/>}
    </>}
    {bill && <Button label={Platform.OS === "web" ? "Xem / In hóa đơn" : "Chia sẻ hóa đơn"} disabled={busy}
      onPress={() => printDiningReceipt(bill)}/>}
  </View>;
}
function Button({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
    disabled={disabled} onPress={onPress} style={[s.button, disabled && s.disabled]}>
    <Text style={s.buttonText}>{label}</Text></Pressable>;
}
const s = StyleSheet.create({
  root: { paddingTop: 12, paddingBottom: 18, gap: 10, borderTopWidth: 1, borderTopColor: C.border },
  title: { fontSize: 16, fontWeight: "900", color: C.ink },
  label: { fontSize: 12, fontWeight: "800", color: C.ink },
  help: { fontSize: 12, lineHeight: 18, color: C.muted },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12,
    borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.paper },
  chipOn: { backgroundColor: "#F8DFDF", borderColor: C.red },
  chipText: { fontWeight: "700", fontSize: 12, color: C.ink },
  chipTextOn: { color: C.red },
  button: { paddingHorizontal: 13, minHeight: 44, borderRadius: 10, backgroundColor: C.red,
    alignItems: "center", justifyContent: "center" },
  buttonText: { color: "white", fontWeight: "800", fontSize: 13, textAlign: "center" },
  disabled: { opacity: .46 },
  input: { minHeight: 44, borderWidth: 1, borderColor: C.border,
    borderRadius: 9, paddingHorizontal: 12, backgroundColor: C.paper, color: C.ink },
  error: { fontSize: 12, color: C.red, lineHeight: 18 },
  info: { fontSize: 12, color: C.green, fontWeight: "800", lineHeight: 18 },
  payment: { padding: 12, gap: 8, borderWidth: 1, borderColor: C.border,
    borderRadius: 11, backgroundColor: C.cream },
  qr: { width: 240, height: 240, alignSelf: "center" },
});
