import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import { request, type Branch } from "./api";
import { Action, Field, Notice } from "./ui";
import { c, font } from "./theme";

const coordinate = /^-?\d+(?:\.\d{1,7})?$/;
const branchCode = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

export function BranchPanel({ token, branch, onSaved, onCancel }: {
  token: string;
  branch?: Branch;
  onSaved: (id: string, created: boolean) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(branch?.name ?? "");
  const [code, setCode] = useState(branch?.code ?? "");
  const [address, setAddress] = useState(branch?.address ?? "");
  const [lat, setLat] = useState(branch?.latitude?.toString() ?? "");
  const [lng, setLng] = useState(branch?.longitude?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [confirmStatus, setConfirmStatus] = useState(false);
  useEffect(() => {
    setName(branch?.name ?? "");
    setCode(branch?.code ?? "");
    setAddress(branch?.address ?? "");
    setLat(branch?.latitude?.toString() ?? "");
    setLng(branch?.longitude?.toString() ?? "");
    setError(""); setFeedback(""); setConfirmStatus(false);
  }, [branch?.id]);

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
    if (!branch || saving) return;
    setSaving(true); setError(""); setFeedback("");
    try {
      const updated = await request<Branch>("/admin/branches/" + branch.id, token,
        "PATCH", { isActive: !branch.isActive });
      setConfirmStatus(false);
      await onSaved(updated.id, false);
      setFeedback(updated.isActive ? "Chi nhánh đã kích hoạt." : "Đã tạm dừng chi nhánh.");
    } catch (e) {
      const text = e instanceof Error ? e.message : "Không cập nhật được trạng thái.";
      setError(text.includes("BRANCH_SETUP_INCOMPLETE")
        ? "Phải lưu đủ lịch 7 ngày và ít nhất một chính sách giao hàng trước khi kích hoạt."
        : text);
    } finally { setSaving(false); }
  }

  return <View style={st.panel}>
    <Text style={st.title}>{branch ? "Thông tin cửa hàng" : "Tạo chi nhánh đầu tiên"}</Text>
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
    {!!error && <Notice error text={error} />}
    {!!feedback && <Notice text={feedback} />}
    <Action label={saving ? "Đang lưu..." : branch ? "Lưu thông tin chi nhánh" : "Tạo chi nhánh"}
      onPress={() => void save()} disabled={saving || locating} />
    {onCancel && <Action label="Hủy" secondary onPress={onCancel} disabled={saving} />}
    {branch && <>
      {!confirmStatus ? <Action label={branch.isActive ? "Tạm dừng chi nhánh" : "Kích hoạt chi nhánh"}
        secondary onPress={() => setConfirmStatus(true)} disabled={saving} /> :
        <View style={st.confirm}>
          <Text style={st.hint}>{branch.isActive
            ? "Xác nhận tạm dừng: khách sẽ không tạo được đơn mới tại chi nhánh."
            : "Chỉ kích hoạt sau khi lưu giờ bán và chính sách giao hàng thật."}</Text>
          <Action label="Xác nhận đổi trạng thái" dangerous
            onPress={() => void updateStatus()} disabled={saving} />
          <Action label="Không đổi" secondary onPress={() => setConfirmStatus(false)}
            disabled={saving} />
        </View>}
    </>}
  </View>;
}
const st = StyleSheet.create({
  panel: { gap: 12, borderRadius: 12, borderWidth: 1, borderColor: c.line,
    padding: 14, backgroundColor: c.white },
  title: { fontSize: font.section, fontWeight: "800", color: c.ink },
  hint: { fontSize: font.note, lineHeight: 19, color: c.secondary },
  coordinates: { flexDirection: "row", gap: 10 },
  coordinate: { flex: 1, minWidth: 0 },
  confirm: { gap: 8, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 12 },
});
