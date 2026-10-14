import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { request } from "./api";
import { Action, Field, Notice, Pill } from "./ui";
import { c, font } from "./theme";

interface Policy {
  version: number; acceptingOrders: boolean;
  baseMeters: number; baseFeeVnd: number;
  extraStepMeters: number; extraStepFeeVnd: number;
  maxRoadMeters: number; minSubtotalVnd: number;
  freeDeliveryAtSubtotalVnd: number | null;
}
type NumericKey = "baseMeters" | "baseFeeVnd" | "extraStepMeters" |
  "extraStepFeeVnd" | "maxRoadMeters" | "minSubtotalVnd" | "freeDeliveryAtSubtotalVnd";
const labels: { key: NumericKey; label: string }[] = [
  { key: "baseMeters", label: "Số mét giao cơ bản" },
  { key: "baseFeeVnd", label: "Phí giao cơ bản (VND)" },
  { key: "extraStepMeters", label: "Bước phụ thu (mét)" },
  { key: "extraStepFeeVnd", label: "Phụ thu mỗi bước (VND)" },
  { key: "maxRoadMeters", label: "Khoảng cách đường tối đa (mét)" },
  { key: "minSubtotalVnd", label: "Đơn hàng tối thiểu (VND)" },
  { key: "freeDeliveryAtSubtotalVnd", label: "Miễn phí giao từ (VND, có thể để trống)" },
];
const bounds: Record<NumericKey, [number, number]> = {
  baseMeters: [0, 100000], baseFeeVnd: [0, 10000000],
  extraStepMeters: [1, 100000], extraStepFeeVnd: [0, 10000000],
  maxRoadMeters: [1, 300000], minSubtotalVnd: [0, 1000000000],
  freeDeliveryAtSubtotalVnd: [0, 1000000000],
};
const blank: Record<NumericKey, string> = {
  baseMeters: "", baseFeeVnd: "", extraStepMeters: "", extraStepFeeVnd: "",
  maxRoadMeters: "", minSubtotalVnd: "", freeDeliveryAtSubtotalVnd: "",
};

export function DeliveryPolicyPanel({ token, branchId, active }: {
  token: string; branchId: string; active: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState<Policy | null>(null);
  const [numbers, setNumbers] = useState<Record<NumericKey, string>>({ ...blank });
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let live = true;
    setLoading(true); setError(""); setSuccess("");
    request<Policy | null>("/admin/branches/" + branchId + "/delivery-policy", token)
      .then(value => {
        if (!live) return;
        setCurrent(value);
        setAccepting(value?.acceptingOrders ?? false);
        setNumbers(value ? Object.fromEntries(labels.map(({ key }) => [key,
          value[key] == null ? "" : String(value[key])])) as Record<NumericKey, string>
          : { ...blank });
      })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : "Không tải được phí giao."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [branchId, token]);

  async function save() {
    if (saving) return;
    const payload: Record<string, number | boolean | null> = { acceptingOrders: accepting };
    for (const { key } of labels) {
      const raw = numbers[key].trim();
      if (key === "freeDeliveryAtSubtotalVnd" && raw === "") { payload[key] = null; continue; }
      const [min, max] = bounds[key];
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) ||
        Number(raw) < min || Number(raw) > max) {
        setError("Giá trị không hợp lệ tại: " + labels.find(x => x.key === key)?.label);
        return;
      }
      payload[key] = Number(raw);
    }
    if ((payload.baseMeters as number) > (payload.maxRoadMeters as number)) {
      setError("Khoảng cách cơ bản không được lớn hơn khoảng cách tối đa.");
      return;
    }
    setSaving(true); setError(""); setSuccess("");
    try {
      const saved = await request<Policy>("/admin/branches/" + branchId + "/delivery-policy",
        token, "POST", payload);
      setCurrent(saved);
      setSuccess("Đã lưu phiên bản " + saved.version + " của chính sách giao hàng.");
    } catch (e) { setError(e instanceof Error ? e.message : "Không lưu được phí giao."); }
    finally { setSaving(false); }
  }

  return <View style={st.panel}>
    <Text style={st.title}>Nhận đơn & chính sách giao hàng</Text>
    {loading ? <ActivityIndicator color={c.red} /> : <>
      {!current && <Notice text="Chưa cấu hình phí giao. Hệ thống không tự áp phí 0 đồng và chưa thể nhận đơn." />}
      {current && <Text style={st.note}>Phiên bản chính sách hiện tại: {current.version}</Text>}
      {!active && <Notice text="Chi nhánh đang tạm dừng. Sau khi lưu giờ bán và phí giao, quay lại phần thông tin cửa hàng để kích hoạt." />}
      <Text style={st.note}>Trạng thái nhận đơn (ghi nhận thành phiên bản mới khi nhấn Lưu)</Text>
      <View style={st.row}>
        <Pill label="Dừng nhận đơn" active={!accepting} onPress={() => setAccepting(false)} />
        <Pill label="Nhận đơn" active={accepting} onPress={() => setAccepting(true)} />
      </View>
      {labels.map(({ key, label }) => <Field key={key} label={label}
        numeric placeholder={key === "freeDeliveryAtSubtotalVnd" ? "Không áp dụng" : "Nhập số nguyên"}
        value={numbers[key]} onChangeText={v => setNumbers(old => ({ ...old, [key]: v }))} />)}
      {!!error && <Notice text={error} error />}
      {!!success && <Notice text={success} />}
      <Action disabled={saving} label={saving ? "Đang lưu..." : "Lưu chính sách giao hàng"}
        onPress={() => void save()} />
    </>}
  </View>;
}
const st = StyleSheet.create({
  panel: { gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c.line },
  title: { fontSize: font.section, fontWeight: "800", color: c.ink },
  note: { fontSize: font.note, lineHeight: 18, color: c.secondary },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
});
