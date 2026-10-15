import React, { useEffect, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import { request, type Branch } from "./api";
import { Action, Field, Notice } from "./ui";
import { c, font } from "./theme";
import { StatusSwitch } from "./StatusSwitch";
import { VietnamAdministrativeAreaPicker } from "../../../packages/ui/src/VietnamAdministrativeAreaPicker";
import { ADMIN_CATALOG_VERSION, validateAdministrativeSelection, approximateWardDistanceKm } from "../../../packages/shared/src/vietnam-admin";

const coordinate = /^-?\d+(?:\.\d{1,7})?$/;
const branchCode = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

export function BranchPanel({ token, branch, onSaved, onCancel, mode = "details", onDirtyChange }: {
  token: string;
  branch?: Branch;
  onSaved: (id: string, created: boolean) => Promise<void>;
  onCancel?: () => void;
  mode?: "details" | "status";
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [name, setName] = useState(branch?.name ?? "");
  const [code, setCode] = useState(branch?.code ?? "");
  const [address, setAddress] = useState(branch?.address ?? "");
  const [provinceCode, setProvinceCode] = useState<string | null>(branch?.provinceCode ?? null);
  const [wardCode, setWardCode] = useState<string | null>(branch?.wardCode ?? null);
  const [lat, setLat] = useState(branch?.latitude?.toString() ?? "");
  const [lng, setLng] = useState(branch?.longitude?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [confirmStatus, setConfirmStatus] = useState<boolean | null>(null);
  useEffect(() => {
    setName(branch?.name ?? "");
    setCode(branch?.code ?? "");
    setAddress(branch?.address ?? "");
    setProvinceCode(branch?.provinceCode ?? null); setWardCode(branch?.wardCode ?? null);
    setLat(branch?.latitude?.toString() ?? "");
    setLng(branch?.longitude?.toString() ?? "");
    setError(""); setFeedback(""); setConfirmStatus(null);
  }, [branch?.id]);

  useEffect(() => {
    onDirtyChange?.(mode === "details" && (
      name !== (branch?.name ?? "") || code !== (branch?.code ?? "") ||
      address !== (branch?.address ?? "") ||
      provinceCode !== (branch?.provinceCode ?? null) ||
      wardCode !== (branch?.wardCode ?? null) ||
      lat !== (branch?.latitude?.toString() ?? "") ||
      lng !== (branch?.longitude?.toString() ?? "")));
  }, [mode, name, code, address, provinceCode, wardCode, lat, lng, branch, onDirtyChange]);

  async function locateStore() {
    if (locating || saving) return;
    setLocating(true); setError(""); setFeedback("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        throw new Error("Chưa có quyền truy cập GPS. Hãy cấp quyền vị trí cho ứng dụng hoặc nhập tọa độ thủ công.");
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const { latitude, longitude } = position.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error("GPS chưa trả về tọa độ hợp lệ. Hãy thử lại.");
      }
      setLat(latitude.toFixed(7));
      setLng(longitude.toFixed(7));
      setFeedback("Đã lấy vị trí thiết bị. Hãy xác nhận đây là địa điểm cửa hàng trước khi lưu.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể lấy GPS. Hãy kiểm tra quyền vị trí và thử lại.");
    } finally {
      setLocating(false);
    }
  }

  async function save() {
    if (saving || locating) return;
    if (!validateAdministrativeSelection({ catalogVersion: ADMIN_CATALOG_VERSION, provinceCode, wardCode })) {
      setError("Cần chọn tỉnh/thành và phường/xã từ danh mục trước khi lưu."); return;
    }
    if (name.trim().length < 2 || name.trim().length > 200 ||
      address.trim().length < 10 || address.trim().length > 500 ||
      (!branch && !branchCode.test(code.trim())) ||
      !coordinate.test(lat.trim()) || !coordinate.test(lng.trim()) ||
      Math.abs(Number(lat)) > 90 || Math.abs(Number(lng)) > 180) {
      setError("Kiểm tra tên, mã chi nhánh, địa chỉ (ít nhất 10 ký tự) và GPS tối đa 7 chữ số thập phân.");
      return;
    }
    setSaving(true); setError(""); setFeedback("");
    try {
      const payload = { name: name.trim(), address: address.trim(),
        catalogVersion: ADMIN_CATALOG_VERSION, provinceCode, wardCode,
        latitude: Number(lat), longitude: Number(lng),
        ...(branch ? {} : { code: code.trim() }) };
      const result = await request<Branch>(branch
        ? "/admin/branches/" + branch.id : "/admin/branches", token,
        branch ? "PATCH" : "POST", payload);
      await onSaved(result.id, !branch);
      if (branch) setFeedback("Đã lưu thông tin chi nhánh.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được chi nhánh.");
    } finally { setSaving(false); }
  }

  async function updateStatus() {
    if (!branch || saving || confirmStatus === null || confirmStatus === branch.isActive) return;
    setSaving(true); setError(""); setFeedback("");
    try {
      const updated = await request<Branch>("/admin/branches/" + branch.id, token,
        "PATCH", { isActive: confirmStatus });
      setConfirmStatus(null);
      await onSaved(updated.id, false);
      setFeedback(updated.isActive ? "Chi nhánh đã kích hoạt." : "Đã tạm dừng chi nhánh.");
    } catch (e) {
      const text = e instanceof Error ? e.message : "Không cập nhật được trạng thái.";
      setError(text.includes("BRANCH_SETUP_INCOMPLETE")
        ? "Phải lưu đủ lịch 7 ngày và ít nhất một chính sách giao hàng trước khi kích hoạt."
        : text);
    } finally { setSaving(false); }
  }

  if (mode === "status" && branch) return <View style={st.panel}>
    <Text style={st.title}>Trạng thái chi nhánh</Text>
    <Notice text={branch.isActive
      ? "Chi nhánh đã kích hoạt. Muốn nhận đơn, cần bật thêm trong mục Nhận đơn."
      : "Chi nhánh đang tạm dừng. Khách không thể đặt đơn tại đây."} />
    {!!error && <Notice text={error} error />}
    {!!feedback && <Notice text={feedback} />}
    <View style={st.statusRow}>
      <View style={st.statusCopy}>
        <Text style={st.statusLabel}>Kích hoạt chi nhánh</Text>
        <Text style={st.hint}>{branch.isActive ? "Đang bật" : "Đang tạm dừng"}</Text>
      </View>
      <StatusSwitch value={branch.isActive} busy={saving}
        label="Kích hoạt chi nhánh"
        onValueChange={next => { setError(""); setFeedback(""); setConfirmStatus(next); }} />
    </View>
    <Modal visible={confirmStatus !== null} transparent animationType="fade"
      onRequestClose={() => { if (!saving) setConfirmStatus(null); }}>
      <View style={st.confirmBackdrop}>
        <View style={st.confirmDialog}>
          <Text style={st.title}>Xác nhận trạng thái chi nhánh</Text>
          <Text style={st.hint}>{confirmStatus
            ? "Kích hoạt khi đã có lịch bán và chính sách phí giao hợp lệ. Nhận đơn còn phụ thuộc trạng thái chính sách."
            : "Tạm dừng chi nhánh sẽ ngăn khách tạo đơn mới. Đơn đã đặt vẫn được giữ nguyên."}</Text>
          {!!error && <Notice text={error} error />}
          <View style={st.confirmActions}>
            <Action label="Giữ nguyên" secondary disabled={saving}
              onPress={() => setConfirmStatus(null)} />
            <Action label={saving ? "Đang cập nhật..." : "Xác nhận thay đổi"}
              dangerous disabled={saving} onPress={() => void updateStatus()} />
          </View>
        </View>
      </View>
    </Modal>
  </View>;

  return <View style={st.panel}>
    <Text style={st.title}>{branch ? "Thông tin & định vị" : "Chi nhánh mới"}</Text>
    {branch && <>
      <Notice text={branch.isActive
        ? "Chi nhánh đang hoạt động. Việc nhận đơn vẫn phụ thuộc chính sách giao hàng."
        : "Chi nhánh đang tạm dừng, khách chưa thể đặt đơn tại đây."} />
      <Text style={st.hint}>Mã chi nhánh: {branch.code}</Text>
    </>}
    <Field label="Tên cửa hàng" value={name} onChangeText={setName}
      placeholder="Tên hiển thị cho khách" />
    {!branch && <Field label="Mã chi nhánh (không dấu, chữ thường)" value={code}
      onChangeText={setCode} placeholder="vi-du-quan-1" />}
    <VietnamAdministrativeAreaPicker provinceCode={provinceCode} wardCode={wardCode}
      onChange={(p, w) => { setProvinceCode(p); setWardCode(w); setFeedback(""); }} />
    {!!branch && !validateAdministrativeSelection(branch) &&
      <Notice text="Chi nhánh cũ: cần chọn lại tỉnh/phường trước khi sửa thông tin." />}
    <Field label="Địa chỉ cửa hàng" value={address} onChangeText={setAddress}
      placeholder="Số nhà, đường, phường, tỉnh/thành" multiline />
    <Text style={st.hint}>Chỉ dùng GPS khi đang đứng tại cửa hàng. Vị trí thiết bị có thể khác địa chỉ kinh doanh.</Text>
    <Action label={locating ? "Đang xác định GPS..." : "Lấy định vị GPS hiện tại"}
      secondary disabled={saving || locating} onPress={() => void locateStore()} />
    <View style={st.coordinates}>
      <View style={st.coordinate}><Field label="Vĩ độ (latitude)" value={lat}
        onChangeText={setLat} placeholder="10.1234567" /></View>
      <View style={st.coordinate}><Field label="Kinh độ (longitude)" value={lng}
        onChangeText={setLng} placeholder="106.1234567" /></View>
    </View>
    {(() => {
      const gap = lat && lng ? approximateWardDistanceKm({
        catalogVersion: ADMIN_CATALOG_VERSION, provinceCode, wardCode,
      }, Number(lat), Number(lng)) : null;
      return gap !== null && gap > 30
        ? <Notice text="GPS có vẻ xa khu vực đã chọn. Hãy xác minh ghim thủ công; cảnh báo này không thay đổi phí giao." />
        : null;
    })()}
    {!!error && <Notice error text={error} />}
    {!!feedback && <Notice text={feedback} />}
    <Action label={saving ? "Đang lưu..." : branch ? "Lưu thông tin chi nhánh" : "Tạo chi nhánh"}
      onPress={() => void save()} disabled={saving || locating} />
    {onCancel && <Action label="Hủy" secondary onPress={onCancel} disabled={saving} />}
  </View>;
}
const st = StyleSheet.create({
  statusRow: { minHeight: 54, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  statusCopy: { flex: 1, gap: 4 },
  statusLabel: { color: c.ink, fontSize: font.action, fontWeight: "700" },
  confirmBackdrop: { flex: 1, backgroundColor: "rgba(10,16,22,0.58)", justifyContent: "center", alignItems: "center", padding: 18 },
  confirmDialog: { width: "100%", maxWidth: 390, backgroundColor: c.white, borderRadius: 16, padding: 20, gap: 14 },
  confirmActions: { flexDirection: "row", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" },
  panel: { gap: 10, backgroundColor: c.white },
  title: { fontSize: font.section, fontWeight: "800", color: c.ink },
  hint: { fontSize: font.note, lineHeight: 19, color: c.secondary },
  coordinates: { flexDirection: "row", gap: 10 },
  coordinate: { flex: 1, minWidth: 0 },
  confirm: { gap: 8, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 12 },
});
