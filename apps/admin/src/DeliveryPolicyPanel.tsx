import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { request } from "./api";
import { Action, Field, Notice } from "./ui";
import { StatusSwitch } from "./StatusSwitch";
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
  { key: "baseMeters", label: "Quãng đường cơ bản (km)" },
  { key: "baseFeeVnd", label: "Phí giao cơ bản (đ)" },
  { key: "extraStepMeters", label: "Mỗi bước phụ thu (km)" },
  { key: "extraStepFeeVnd", label: "Phí mỗi bước (đ)" },
  { key: "maxRoadMeters", label: "Phạm vi giao tối đa (km)" },
  { key: "minSubtotalVnd", label: "Đơn hàng tối thiểu (đ)" },
  { key: "freeDeliveryAtSubtotalVnd", label: "Miễn phí giao từ (đ, để trống nếu không áp dụng)" },
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

const metersKeys: NumericKey[] = ["baseMeters", "extraStepMeters", "maxRoadMeters"];
const showNumber = (key: NumericKey, value: number | null) =>
  value == null ? "" : String(metersKeys.includes(key) ? value / 1000 : value);

export function DeliveryPolicyPanel({ token, branchId, active, mode = "delivery", onDirtyChange }: {
  token: string; branchId: string; active: boolean;
  mode?: "delivery" | "orders"; onDirtyChange?: (dirty: boolean) => void;
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
          showNumber(key, value[key])])) as Record<NumericKey, string>
          : { ...blank });
      })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : "Không tải được phí giao."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [branchId, token]);

  const hasChanges = accepting !== (current?.acceptingOrders ?? false) ||
    labels.some(({ key }) => numbers[key] !== (current ? showNumber(key, current[key]) : ""));
  useEffect(() => {
    if (!loading) onDirtyChange?.(hasChanges);
  }, [hasChanges, loading, onDirtyChange]);

  async function save() {
    if (saving) return;
    const payload: Record<string, number | boolean | null> = { acceptingOrders: accepting };
    for (const { key } of labels) {
      const raw = numbers[key].trim();
      if (key === "freeDeliveryAtSubtotalVnd" && raw === "") { payload[key] = null; continue; }
      const [min, max] = bounds[key];
      const distance = metersKeys.includes(key);
      const value = distance ? Math.round(Number(raw) * 1000) : Number(raw);
      if (!(distance ? /^\d+(?:\.\d{1,3})?$/.test(raw) : /^\d+$/.test(raw)) ||
        !Number.isSafeInteger(value) || value < min || value > max) {
        setError("Giá trị không hợp lệ tại: " + labels.find(x => x.key === key)?.label);
        return;
      }
      payload[key] = value;
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
      setAccepting(saved.acceptingOrders);
      setNumbers(Object.fromEntries(labels.map(({ key }) => [key,
        showNumber(key, saved[key])])) as Record<NumericKey, string>);
      setSuccess("Đã lưu phiên bản " + saved.version + " của chính sách giao hàng.");
    } catch (e) { setError(e instanceof Error ? e.message : "Không lưu được phí giao."); }
    finally { setSaving(false); }
  }

  return <View style={st.panel}>
    <Text style={st.title}>{mode === "delivery" ? "Chính sách giao hàng" : "Nhận đơn trực tuyến"}</Text>
    {loading ? <ActivityIndicator color={c.red} /> : <>
      {!current && <Notice text="Chưa cấu hình phí giao. Hệ thống không tự áp phí 0 đồng và chưa thể nhận đơn." />}
      {current && <View style={st.savedPolicy}>
        <View style={st.savedHeading}>
          <Text style={st.savedTitle}>Phí giao đang áp dụng</Text>
          <Text style={st.version}>Phiên bản {current.version}</Text>
        </View>
        <View style={st.savedLine}><Text style={st.note}>Km cơ bản</Text>
          <Text style={st.savedValue}>{showNumber("baseMeters", current.baseMeters)} km · {current.baseFeeVnd.toLocaleString("vi-VN")} đ</Text></View>
        <View style={st.savedLine}><Text style={st.note}>Phụ thu sau mỗi</Text>
          <Text style={st.savedValue}>{showNumber("extraStepMeters", current.extraStepMeters)} km · +{current.extraStepFeeVnd.toLocaleString("vi-VN")} đ</Text></View>
        <View style={st.savedLine}><Text style={st.note}>Giao tối đa</Text>
          <Text style={st.savedValue}>{showNumber("maxRoadMeters", current.maxRoadMeters)} km</Text></View>
        <View style={st.savedLine}><Text style={st.note}>Đơn tối thiểu</Text>
          <Text style={st.savedValue}>{current.minSubtotalVnd.toLocaleString("vi-VN")} đ</Text></View>
        <View style={st.savedLine}><Text style={st.note}>Miễn phí từ</Text>
          <Text style={st.savedValue}>{current.freeDeliveryAtSubtotalVnd === null
            ? "Không áp dụng" : current.freeDeliveryAtSubtotalVnd.toLocaleString("vi-VN") + " đ"}</Text></View>
        <View style={st.savedLine}><Text style={st.note}>Nhận đơn</Text>
          <Text style={st.savedValue}>{current.acceptingOrders ? "Đang bật" : "Đang tạm dừng"}</Text></View>
      </View>}
      {!active && <Notice text="Chi nhánh chưa kích hoạt. Bật Hoạt động sau khi hoàn tất cấu hình giờ bán và phí giao." />}
      {mode === "orders" ? <>
        <Text style={st.note}>Bật nhận đơn chỉ khi cửa hàng có thể xử lý đơn mới. Thao tác này được lưu thành phiên bản chính sách mới.</Text>
        <View style={st.row}>
          <View style={st.rowLabel}>
            <Text style={st.switchTitle}>Cho phép nhận đơn</Text>
            <Text style={st.note}>{accepting ? "Đang chọn nhận đơn" : "Đang chọn tạm dừng"}</Text>
          </View>
          <StatusSwitch value={accepting} label="Cho phép nhận đơn"
            hint="Thay đổi chỉ có hiệu lực sau khi lưu chính sách"
            busy={saving} disabled={!current || (!active && !accepting)}
            onValueChange={next => {
              setAccepting(next); setError(""); setSuccess("");
            }} />
        </View>
      </> : <>
        <Text style={st.note}>Nhập khoảng cách theo km; hệ thống lưu theo mét. Phí và điều kiện được lưu bằng VND nguyên.</Text>
        {([
          { title: "Cước giao cơ bản", keys: ["baseMeters", "baseFeeVnd"] },
          { title: "Phụ thu theo quãng đường", keys: ["extraStepMeters", "extraStepFeeVnd"] },
          { title: "Phạm vi và ưu đãi", keys: ["maxRoadMeters", "minSubtotalVnd", "freeDeliveryAtSubtotalVnd"] },
        ] as { title: string; keys: NumericKey[] }[]).map(section => <View key={section.title} style={st.inputSection}>
          <Text style={st.groupTitle}>{section.title}</Text>
          <View style={st.inputGroupRow}>
            {section.keys.map(key => <View key={key}
              style={key === "freeDeliveryAtSubtotalVnd" ? st.fullColumn : st.inputColumn}>
              <Field label={labels.find(item => item.key === key)!.label}
                numeric={!metersKeys.includes(key)} decimal={metersKeys.includes(key)}
                placeholder={key === "freeDeliveryAtSubtotalVnd" ? "Không áp dụng" : metersKeys.includes(key) ? "Ví dụ: 2.5" : "Nhập số nguyên"}
                value={numbers[key]} onChangeText={v => { setNumbers(old => ({ ...old, [key]: v })); setSuccess(""); }} />
            </View>)}
          </View>
        </View>)}
      </>}
      {mode === "orders" && !current && <Notice error text="Cần thiết lập Phí giao trước khi bật nhận đơn." />}
      {mode === "orders" && !active && <Notice text="Chi nhánh đang tạm dừng. Không thể bật nhận đơn đến khi kích hoạt chi nhánh." />}
      {hasChanges && <Notice text="Thay đổi chưa lưu trên máy chủ. Trạng thái thực tế vẫn theo chính sách hiện tại." />}
      {!!error && <Notice text={error} error />}
      {!!success && <Notice text={success} />}
      <Action disabled={saving || (mode === "orders" && !current)} label={saving ? "Đang lưu..." : mode === "orders" ? "Lưu trạng thái nhận đơn" : "Lưu phí giao"}
        onPress={() => void save()} />
    </>}
  </View>;
}
const st = StyleSheet.create({
  panel: { gap: 10 },
  inputSection: { gap: 7, paddingTop: 9, borderTopWidth: 1, borderTopColor: c.line },
  groupTitle: { fontSize: font.action, color: c.ink, fontWeight: "800" },
  inputGroupRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 },
  inputColumn: { width: "48%", minWidth: 0 },
  fullColumn: { width: "100%" },
  savedPolicy: { gap: 6, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.line, paddingVertical: 10 },
  savedHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  savedTitle: { fontSize: font.action, fontWeight: "800", color: c.ink },
  version: { fontSize: font.note, color: c.secondary },
  savedLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  savedValue: { fontSize: font.note, fontWeight: "700", color: c.ink, flexShrink: 1, textAlign: "right" },
  title: { fontSize: font.section, fontWeight: "800", color: c.ink },
  note: { fontSize: font.note, lineHeight: 18, color: c.secondary },
  row: { minHeight: 52, flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "space-between" },
  rowLabel: { flex: 1, gap: 3 },
  switchTitle: { fontSize: font.action, fontWeight: "700", color: c.ink },
});
