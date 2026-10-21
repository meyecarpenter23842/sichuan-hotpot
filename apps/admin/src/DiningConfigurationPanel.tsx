import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { request } from "./api";
import { Action, Field, Notice, Pill } from "./ui";
import { StatusSwitch } from "./StatusSwitch";
import { TableQrPreview } from "./TableQrPreview";
import { c } from "./theme";

export type DiningArea = { id: string; name: string; sortOrder: number; isActive: boolean };
export type DiningTable = { id: string; areaId: string; name: string; code: string;
  sortOrder: number; isActive: boolean; qrHandle: string; sessions: { id: string }[] };
type Configuration = { areas: DiningArea[]; tables: DiningTable[] };
type AreaDraft = { id?: string; name: string; sortOrder: string; isActive: boolean };
type TableDraft = { id?: string; areaId: string; code: string; name: string;
  sortOrder: string; isActive: boolean };
const safeInt = (value: string) => {
  if (!/^\d{1,4}$/.test(value.trim())) throw new Error("Thứ tự phải là số từ 0 đến 9999.");
  const n = Number(value);
  if (n < 0 || n > 9999) throw new Error("Thứ tự phải từ 0 đến 9999.");
  return n;
};
export function DiningConfigurationPanel({ token, branchId }: { token: string; branchId: string }) {
  const [data, setData] = useState<Configuration | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [areaDraft, setAreaDraft] = useState<AreaDraft | null>(null);
  const [tableDraft, setTableDraft] = useState<TableDraft | null>(null);
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [preview, setPreview] = useState<DiningTable | null>(null);
  const [rotateConfirm, setRotateConfirm] = useState<DiningTable | null>(null);
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const base = "/dining/branches/" + branchId;
  const refresh = useCallback(async () => {
    try {
      const result = await request<Configuration>("/dining/branches/" + branchId + "/configuration", token);
      setData(result); setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "Không tải được khu vực/bàn."); }
    finally { setLoading(false); }
  }, [branchId, token]);
  useEffect(() => {
    setData(null); setLoading(true); setSelectedArea(null); setAreaDraft(null); setTableDraft(null);
    setPreview(null); setRotateConfirm(null); setNotice(""); setError("");
    void refresh();
  }, [refresh]);

  const submit = async () => {
    if (busy) return;
    setError(""); setNotice(""); setBusy(true);
    try {
      if (areaDraft) {
        const body = { name: areaDraft.name.trim(), sortOrder: safeInt(areaDraft.sortOrder) };
        if (!body.name) throw new Error("Hãy nhập tên khu vực.");
        await request(base + (areaDraft.id ? "/areas/" + areaDraft.id : "/areas"), token,
          areaDraft.id ? "PATCH" : "POST", body);
        setAreaDraft(null);
        setNotice("Đã lưu khu vực.");
      } else if (tableDraft) {
        const body = { areaId: tableDraft.areaId, code: tableDraft.code.trim().toUpperCase(),
          name: tableDraft.name.trim(), sortOrder: safeInt(tableDraft.sortOrder) };
        if (!body.code || !body.name || !body.areaId) throw new Error("Hãy nhập mã bàn, tên bàn và khu vực.");
        await request(base + (tableDraft.id ? "/tables/" + tableDraft.id : "/tables"), token,
          tableDraft.id ? "PATCH" : "POST", body);
        setTableDraft(null);
        setNotice("Đã lưu bàn. QR cố định đã sẵn sàng khi bàn được kích hoạt.");
      }
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể lưu."); }
    finally { setBusy(false); }
  };
  const toggle = async (kind: "area" | "table", id: string, next: boolean) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await request(base + (kind === "area" ? "/areas/" : "/tables/") + id,
        token, "PATCH", { isActive: next });
      setNotice(next ? "Đã kích hoạt." : "Đã tạm khóa.");
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Không cập nhật được."); }
    finally { setBusy(false); }
  };
  const rotate = async () => {
    if (!rotateConfirm || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await request(base + "/tables/" + rotateConfirm.id + "/rotate-qr", token, "POST");
      setNotice("Đã thay mã QR. Tem cũ không dùng được; khách phải quét tem mới.");
      setPreview(null); setRotateConfirm(null);
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể đổi mã QR."); }
    finally { setBusy(false); }
  };
  const selectedAreas = data?.areas ?? [];
  const tables = (data?.tables ?? []).filter(t => selectedArea === null || t.areaId === selectedArea);
  const openArea = (area?: DiningArea) => {
    setTableDraft(null);
    setAreaDraft(area ? { id: area.id, name: area.name, sortOrder: String(area.sortOrder),
      isActive: area.isActive } : { name: "", sortOrder: "0", isActive: true });
  };
  const openTable = (table?: DiningTable) => {
    setAreaDraft(null);
    setTableDraft(table ? { id: table.id, areaId: table.areaId, code: table.code,
      name: table.name, sortOrder: String(table.sortOrder), isActive: table.isActive } :
      { areaId: selectedArea ?? selectedAreas.find(a => a.isActive)?.id ?? "",
        code: "", name: "", sortOrder: String((data?.tables.length ?? 0) * 10),
        isActive: true });
  };
  return <View style={s.page}>
    <View style={s.header}>
      <Text style={s.title}>Khu vực, bàn & mã QR</Text>
      <Pressable accessibilityRole="button" style={s.refresh} onPress={() => { void refresh(); }}>
        <Text style={s.refreshText}>Làm mới ↻</Text>
      </Pressable>
    </View>
    <Text style={s.hint}>Thiết lập khu vực, vị trí bàn và tem QR cố định. Bàn đang có phiên không thể bị khóa hoặc chuyển khu vực.</Text>
    {!!error && <Notice error text={error} />}
    {!!notice && <Notice text={notice} />}
    {loading && !data ? <ActivityIndicator color={c.red} size="large" /> :
      !data ? <Action secondary label="Thử tải lại" onPress={() => { void refresh(); }} /> : <>
      <View style={s.heading}>
        <Text style={s.sectionTitle}>Khu vực ({selectedAreas.length})</Text>
        <Action label="+ Khu vực" onPress={() => openArea()} />
      </View>
      {!selectedAreas.length ? <Notice text="Chưa có khu vực. Thêm Tầng 1, VIP hoặc Sân vườn để bắt đầu." /> :
        <View style={s.areaRow}>
          <Pill label="Tất cả" active={!selectedArea} onPress={() => setSelectedArea(null)} />
          {selectedAreas.map(area => <Pill key={area.id}
            label={area.name + (area.isActive ? "" : " · Khóa")}
            active={selectedArea === area.id}
            onPress={() => setSelectedArea(area.id)} />)}
        </View>}
      <View style={s.cards}>
        {selectedAreas.filter(a => selectedArea === null || a.id === selectedArea).map(area =>
          <View key={area.id} style={[s.card, wide && s.cardWide]}>
            <View style={s.cardTitle}>
              <View style={s.copy}>
                <Text style={s.name}>{area.name}</Text>
                <Text style={s.hint}>Thứ tự {area.sortOrder}</Text>
              </View>
              <StatusSwitch value={area.isActive} busy={busy} disabled={busy}
                label={"Bật/tắt khu vực " + area.name} onValueChange={next => {
                  void toggle("area", area.id, next);
                }} />
            </View>
            <Action secondary label="Sửa khu vực" onPress={() => openArea(area)} />
          </View>)}
      </View>
      <View style={s.heading}>
        <Text style={s.sectionTitle}>Bàn ({tables.length})</Text>
        <Action label="+ Thêm bàn" onPress={() => openTable()} />
      </View>
      {!tables.length ? <Notice text="Chưa có bàn trong khu vực này." /> :
        <View style={s.cards}>{tables.map(table => {
          const area = selectedAreas.find(x => x.id === table.areaId);
          const printable = table.isActive && !!area?.isActive;
          return <View key={table.id} style={[s.card, wide && s.cardWide]}>
            <View style={s.cardTitle}>
              <View style={s.copy}>
                <Text style={s.name}>{table.name}</Text>
                <Text style={s.hint}>{table.code} • {area?.name} • Thứ tự {table.sortOrder}</Text>
                <Text style={[s.hint, table.sessions.length > 0 && s.occupied]}>
                  {table.sessions.length > 0 ? "Đang có phiên" :
                    printable ? "Sẵn sàng • QR có thể in" : "Đang tạm khóa"}
                </Text>
              </View>
              <StatusSwitch value={table.isActive} disabled={busy} busy={busy}
                label={"Bật/tắt bàn " + table.code} onValueChange={next => {
                  void toggle("table", table.id, next);
                }} />
            </View>
            <View style={s.cardActions}>
              <Action secondary label="Sửa bàn" onPress={() => openTable(table)} />
              <Action secondary label="Xem QR" disabled={!printable}
                onPress={() => setPreview(table)} />
              <Action dangerous label="Đổi QR" disabled={!printable}
                onPress={() => setRotateConfirm(table)} />
            </View>
          </View>;
        })}</View>}
    </>}
    <Modal visible={!!areaDraft || !!tableDraft} transparent animationType="slide"
      onRequestClose={() => { if (!busy) { setAreaDraft(null); setTableDraft(null); } }}>
      <SafeAreaView style={s.overlay} edges={["top", "bottom"]}>
        <View style={s.dialog}>
          <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
            <Text style={s.sectionTitle}>{areaDraft
              ? (areaDraft.id ? "Sửa khu vực" : "Thêm khu vực")
              : (tableDraft?.id ? "Sửa bàn" : "Thêm bàn")}</Text>
            {areaDraft && <>
              <Field label="Tên khu vực" value={areaDraft.name} maxLength={120}
                onChangeText={name => setAreaDraft({ ...areaDraft, name })} />
              <Field label="Thứ tự hiển thị" value={areaDraft.sortOrder} numeric
                onChangeText={sortOrder => setAreaDraft({ ...areaDraft, sortOrder })} />
            </>}
            {tableDraft && <>
              <Text style={s.hint}>Chọn khu vực cho bàn</Text>
              <View style={s.areaRow}>
                {selectedAreas.filter(a => a.isActive || a.id === tableDraft.areaId).map(a =>
                  <Pill key={a.id} label={a.name} active={tableDraft.areaId === a.id}
                    onPress={() => setTableDraft({ ...tableDraft, areaId: a.id })} />)}
              </View>
              <Field label="Mã bàn" value={tableDraft.code} maxLength={40}
                onChangeText={code => setTableDraft({ ...tableDraft, code })} />
              <Field label="Tên bàn" value={tableDraft.name} maxLength={120}
                onChangeText={name => setTableDraft({ ...tableDraft, name })} />
              <Field label="Thứ tự hiển thị" value={tableDraft.sortOrder} numeric
                onChangeText={sortOrder => setTableDraft({ ...tableDraft, sortOrder })} />
            </>}
            <View style={s.dialogActions}>
              <Action secondary disabled={busy} label="Hủy"
                onPress={() => { setAreaDraft(null); setTableDraft(null); }} />
              <Action disabled={busy} label={busy ? "Đang lưu..." : "Lưu"}
                onPress={() => { void submit(); }} />
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
    <Modal visible={!!preview} transparent animationType="slide" onRequestClose={() => setPreview(null)}>
      <SafeAreaView style={s.overlay} edges={["top", "bottom"]}>
        <View style={s.dialog}>
          {preview && <TableQrPreview table={preview} />}
          <Action secondary label="Quay lại" onPress={() => setPreview(null)} />
        </View>
      </SafeAreaView>
    </Modal>
    <Modal visible={!!rotateConfirm} transparent animationType="fade"
      onRequestClose={() => { if (!busy) setRotateConfirm(null); }}>
      <SafeAreaView style={s.overlay} edges={["top", "bottom"]}>
        <View style={s.dialog}>
          <Text style={s.sectionTitle}>Thu hồi và tạo QR mới?</Text>
          <Text style={s.hint}>Tem QR của {rotateConfirm?.name} sẽ hết hiệu lực ngay. Khách đã quét phải quét lại; yêu cầu QR còn chờ duyệt sẽ bị từ chối. Phiên bàn đã mở vẫn được giữ.</Text>
          <View style={s.dialogActions}>
            <Action secondary disabled={busy} label="Hủy" onPress={() => setRotateConfirm(null)} />
            <Action dangerous disabled={busy} label="Xác nhận đổi QR" onPress={() => { void rotate(); }} />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  </View>;
}
const s = StyleSheet.create({
  page: { padding: 12, paddingBottom: 30, gap: 13 },
  title: { fontSize: 18, color: c.ink, fontWeight: "900" },
  sectionTitle: { fontSize: 15, color: c.ink, fontWeight: "800" },
  hint: { color: c.secondary, fontSize: 12, lineHeight: 18 },
  occupied: { color: c.orange, fontWeight: "800" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  refresh: { minHeight: 44, paddingHorizontal: 10, justifyContent: "center" },
  refreshText: { color: c.red, fontWeight: "800" },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  areaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: { width: "100%", backgroundColor: c.white, borderWidth: 1, borderColor: c.line,
    borderRadius: 12, padding: 12, gap: 12 },
  cardWide: { width: "49%" },
  cardTitle: { flexDirection: "row", alignItems: "center", gap: 8 },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontSize: 15, color: c.ink, fontWeight: "800" },
  cardActions: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center",
    padding: 12 },
  dialog: { width: "100%", maxWidth: 540, maxHeight: "90%", alignSelf: "center",
    backgroundColor: c.white, borderRadius: 14, padding: 16, gap: 16 },
  form: { gap: 15 },
  dialogActions: { flexDirection: "row", flexWrap: "wrap",
    alignItems: "center", justifyContent: "flex-end", gap: 10 },
});
