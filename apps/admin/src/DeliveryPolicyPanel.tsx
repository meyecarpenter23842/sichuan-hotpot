import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { request } from "./api";
import { Action, Field, Notice } from "./ui";
import { StatusSwitch } from "./StatusSwitch";
import { c, font } from "./theme";

interface Zone {
  id?: string;
  name: string;
  provinceCode: string;
  catalogVersion: string;
  wardCodes: string[];
  feeVnd: number;
  isActive: boolean;
}
interface Policy {
  version: number;
  pricingMode: "DISTANCE" | "ZONE";
  acceptingOrders: boolean;
  minSubtotalVnd: number;
  freeDeliveryAtSubtotalVnd: number | null;
  zones: Zone[];
}
type ZoneDraft = { name: string; provinceCode: string; catalogVersion: string;
  wardCodes: string; feeVnd: string };
const blankZone: ZoneDraft = { name: "", provinceCode: "", catalogVersion: "",
  wardCodes: "", feeVnd: "" };
const isVnd = (v: string) => /^\d+$/.test(v) && Number.isSafeInteger(Number(v))
  && Number(v) >= 0 && Number(v) <= 1000000000;
const normalize = (value: Policy) => ({
  acceptingOrders: value.acceptingOrders,
  minSubtotalVnd: String(value.minSubtotalVnd),
  freeDeliveryAtSubtotalVnd: value.freeDeliveryAtSubtotalVnd === null ? "" :
    String(value.freeDeliveryAtSubtotalVnd),
  zones: value.zones.map(zone => ({
    name: zone.name, provinceCode: zone.provinceCode,
    catalogVersion: zone.catalogVersion, wardCodes: [...zone.wardCodes],
    feeVnd: zone.feeVnd, isActive: zone.isActive,
  })),
});

export function DeliveryPolicyPanel({ token, branchId, active, mode = "delivery", onDirtyChange }: {
  token: string; branchId: string; active: boolean;
  mode?: "delivery" | "orders"; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState<Policy | null>(null);
  const [acceptingOrders, setAcceptingOrders] = useState(false);
  const [minimum, setMinimum] = useState("0");
  const [freeFrom, setFreeFrom] = useState("");
  const [zones, setZones] = useState<Zone[]>([]);
  const [draft, setDraft] = useState<ZoneDraft>({ ...blankZone });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function applyPolicy(value: Policy | null) {
    setCurrent(value);
    setAcceptingOrders(value?.acceptingOrders ?? false);
    setMinimum(String(value?.minSubtotalVnd ?? 0));
    setFreeFrom(value?.freeDeliveryAtSubtotalVnd == null ? "" :
      String(value.freeDeliveryAtSubtotalVnd));
    setZones(value?.pricingMode === "ZONE" ? value.zones ?? [] : []);
  }
  useEffect(() => {
    let live = true;
    setLoading(true); setError(""); setSuccess("");
    request<Policy | null>("/admin/branches/" + branchId + "/delivery-policy", token)
      .then(value => { if (live) applyPolicy(value); })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : "Không tải được phí giao."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [branchId, token]);

  const pending = { acceptingOrders, minSubtotalVnd: minimum,
    freeDeliveryAtSubtotalVnd: freeFrom,
    zones: zones.map(zone => ({ name: zone.name, provinceCode: zone.provinceCode,
      catalogVersion: zone.catalogVersion, wardCodes: zone.wardCodes,
      feeVnd: zone.feeVnd, isActive: zone.isActive })) };
  const hasChanges = JSON.stringify(pending) !== JSON.stringify(current &&
    current.pricingMode === "ZONE" ? normalize(current) : {
      acceptingOrders: current?.acceptingOrders ?? false,
      minSubtotalVnd: String(current?.minSubtotalVnd ?? 0),
      freeDeliveryAtSubtotalVnd: current?.freeDeliveryAtSubtotalVnd == null ? "" :
        String(current.freeDeliveryAtSubtotalVnd), zones: [],
    });
  useEffect(() => { if (!loading) onDirtyChange?.(hasChanges); },
    [hasChanges, loading, onDirtyChange]);

  function addZone() {
    const wardCodes = draft.wardCodes.split(",").map(code => code.trim()).filter(Boolean);
    if (!draft.name.trim() || draft.name.length > 160 ||
      !/^[a-zA-Z0-9_-]{1,24}$/.test(draft.provinceCode) ||
      !/^[a-zA-Z0-9_-]{2,40}$/.test(draft.catalogVersion) ||
      wardCodes.some(code => !/^[a-zA-Z0-9_-]{1,24}$/.test(code)) ||
      !isVnd(draft.feeVnd) || Number(draft.feeVnd) > 10000000) {
      setError("Tên vùng, mã tỉnh/phường, phiên bản danh mục hoặc mức phí chưa hợp lệ.");
      return;
    }
    const prefix = draft.catalogVersion + ":" + draft.provinceCode;
    if (zones.some(zone => {
      if (zone.catalogVersion + ":" + zone.provinceCode !== prefix) return false;
      if (wardCodes.length === 0 || zone.wardCodes.length === 0)
        return wardCodes.length === 0 && zone.wardCodes.length === 0;
      return wardCodes.some(code => zone.wardCodes.includes(code));
    }) || new Set(wardCodes).size !== wardCodes.length) {
      setError("Trùng vùng/phường với mức phí đã thiết lập.");
      return;
    }
    setZones(old => [...old, { name: draft.name.trim(), provinceCode: draft.provinceCode,
      catalogVersion: draft.catalogVersion, wardCodes, feeVnd: Number(draft.feeVnd),
      isActive: true }]);
    setDraft({ ...blankZone }); setError(""); setSuccess("");
  }

  async function save() {
    if (saving) return;
    if (!isVnd(minimum) || (freeFrom !== "" && !isVnd(freeFrom)) ||
      !zones.length || !zones.some(zone => zone.isActive)) {
      setError("Cần ít nhất một vùng đang giao, mức đơn tối thiểu và mức miễn phí hợp lệ.");
      return;
    }
    setSaving(true); setError(""); setSuccess("");
    try {
      const payload = {
        pricingMode: "ZONE", acceptingOrders, zones: zones.map(({ id: _id, ...zone }) => zone),
        minSubtotalVnd: Number(minimum),
        freeDeliveryAtSubtotalVnd: freeFrom === "" ? null : Number(freeFrom),
      };
      const value = await request<Policy>("/admin/branches/" + branchId + "/delivery-policy",
        token, "POST", payload);
      applyPolicy(value);
      setSuccess("Đã lưu chính sách phí vùng phiên bản " + value.version + ".");
    } catch (e) { setError(e instanceof Error ? e.message : "Không lưu được chính sách."); }
    finally { setSaving(false); }
  }
  return <View style={st.panel}>
    <Text style={st.title}>{mode === "orders" ? "Nhận đơn trực tuyến" : "Phí giao theo khu vực"}</Text>
    {loading ? <ActivityIndicator color={c.red} /> : <>
      {current?.pricingMode === "DISTANCE" &&
        <Notice text="Chính sách cũ vẫn lưu để đối soát. Thiết lập vùng giao mới trước khi chuyển sang phí theo khu vực." />}
      {!current && <Notice text="Chưa cấu hình phí giao. Đơn sẽ không tự được tính phí 0đ." />}
      {!active && <Notice text="Chi nhánh chưa hoạt động. Không thể nhận đơn mới." />}
      {current?.pricingMode === "ZONE" &&
        <Text style={st.note}>Chính sách hiện tại: phiên bản {current.version} · {current.zones.length} vùng · Không dùng định tuyến OSRM.</Text>}
      {mode === "orders" ? <>
        <Text style={st.note}>Bật/tắt nhận đơn sẽ tạo phiên bản chính sách mới, giữ nguyên phí vùng đang có.</Text>
        <StatusSwitch value={acceptingOrders} busy={saving}
          disabled={current?.pricingMode !== "ZONE" || (!active && !acceptingOrders)}
          label="Cho phép nhận đơn" hint="Chỉ lưu khi vùng giao đã được thiết lập"
          onValueChange={next => { setAcceptingOrders(next); setSuccess(""); }} />
      </> : <>
        <Text style={st.note}>Tính phí bằng mã tỉnh/TP và mã phường/xã/đặc khu theo phiên bản danh mục. Danh sách phường trong cùng vùng dùng chung một mức phí. Để trống phường để làm mức dự phòng toàn tỉnh; mức phường cụ thể được ưu tiên.</Text>
        <Field label="Giá trị đơn tối thiểu (VND)" numeric value={minimum}
          onChangeText={setMinimum} placeholder="0" />
        <Field label="Miễn phí giao từ (VND, để trống nếu không áp dụng)" numeric
          value={freeFrom} onChangeText={setFreeFrom} placeholder="Không miễn phí" />
        <Text style={st.section}>Các vùng giao</Text>
        {zones.length === 0 && <Notice text="Chưa có vùng nào. Chỉ bật nhận đơn khi đã thiết lập và xác minh đầy đủ các mã hành chính." />}
        {zones.map((zone, index) => <View key={index} style={st.zone}>
          <View style={st.row}>
            <View style={st.flex}>
              <Text style={st.zoneName}>{zone.name} · {zone.feeVnd.toLocaleString("vi-VN")} đ</Text>
              <Text style={st.note}>{zone.catalogVersion} / {zone.provinceCode} / {zone.wardCodes.length ? zone.wardCodes.join(", ") : "Toàn tỉnh"}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={"Xóa vùng " + zone.name}
              onPress={() => setZones(old => old.filter((_, i) => i !== index))}>
              <Text style={st.remove}>Xóa</Text>
            </Pressable>
          </View>
          <StatusSwitch label={"Phục vụ vùng " + zone.name} value={zone.isActive}
            disabled={saving} busy={saving}
            onValueChange={enabled => setZones(old => old.map((item, i) =>
              i === index ? { ...item, isActive: enabled } : item))} />
        </View>)}
        <Text style={st.section}>Thêm vùng</Text>
        <Field label="Tên vùng thương mại" value={draft.name}
          onChangeText={name => setDraft(old => ({...old, name}))} placeholder="Ví dụ: Trung tâm" />
        <View style={st.row}>
          <View style={st.flex}><Field label="Phiên bản danh mục" value={draft.catalogVersion}
            onChangeText={catalogVersion => setDraft(old => ({...old, catalogVersion}))}
            placeholder="Mã phiên bản" /></View>
          <View style={st.flex}><Field label="Mã tỉnh/TP" value={draft.provinceCode}
            onChangeText={provinceCode => setDraft(old => ({...old, provinceCode}))}
            placeholder="Mã tỉnh" /></View>
        </View>
        <Field label="Mã phường/xã (phân cách bằng dấu phẩy; bỏ trống = toàn tỉnh)"
          value={draft.wardCodes} onChangeText={wardCodes => setDraft(old => ({...old, wardCodes}))}
          placeholder="Mã phường 1, mã phường 2" />
        <Field label="Phí giao vùng (VND)" numeric value={draft.feeVnd}
          onChangeText={feeVnd => setDraft(old => ({...old, feeVnd}))} placeholder="25000" />
        <Action label="Thêm vùng vào danh sách" disabled={saving} onPress={addZone} />
        <StatusSwitch value={acceptingOrders} label="Cho phép nhận đơn"
          hint="Tắt trước khi cấu hình đủ vùng" disabled={saving || !active} busy={saving}
          onValueChange={setAcceptingOrders} />
      </>}
      {hasChanges && <Notice text="Thay đổi chưa được lưu trên máy chủ." />}
      {!!error && <Notice error text={error} />}
      {!!success && <Notice text={success} />}
      <Action label={saving ? "Đang lưu..." : "Lưu chính sách phí vùng"}
        disabled={saving || (mode === "orders" && current?.pricingMode !== "ZONE") ||
          (mode === "orders" && !hasChanges)}
        onPress={() => void save()} />
    </>}
  </View>;
}

const st = StyleSheet.create({
  panel: { gap: 12 },
  title: { fontSize: font.section, fontWeight: "800", color: c.ink },
  section: { fontSize: font.action, fontWeight: "800", color: c.ink, marginTop: 6 },
  note: { fontSize: font.note, color: c.secondary, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  zone: { paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: c.line },
  zoneName: { fontSize: font.action, fontWeight: "700", color: c.ink },
  remove: { color: c.red, fontSize: font.note, fontWeight: "800", padding: 8 },
});
