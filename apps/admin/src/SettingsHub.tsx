import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BranchPanel } from "./BranchPanel";
import { HoursPanel } from "./HoursPanel";
import { DeliveryPolicyPanel } from "./DeliveryPolicyPanel";
import { type AdminCatalog, type Branch } from "./api";
import { Icon, type IconName } from "./Icon";
import { Action, Notice } from "./ui";
import { c, font } from "./theme";

type Setting = "branch" | "hours" | "delivery" | "status" | "orders" | "create";
const items: { id: Setting; label: string; icon: IconName; hint: string; owner: boolean }[] = [
  { id: "branch", label: "Cửa hàng", icon: "store", hint: "Địa chỉ, vị trí GPS", owner: true },
  { id: "hours", label: "Giờ bán", icon: "clock", hint: "Lịch 7 ngày", owner: false },
  { id: "delivery", label: "Phí giao", icon: "delivery", hint: "Km, phụ phí, giá trị đơn", owner: true },
  { id: "status", label: "Hoạt động", icon: "power", hint: "Kích hoạt chi nhánh", owner: true },
  { id: "orders", label: "Nhận đơn", icon: "bell", hint: "Mở hoặc dừng nhận đơn", owner: true },
  { id: "create", label: "Thêm chi nhánh", icon: "plus", hint: "Tạo cửa hàng mới", owner: true },
];

export function SettingsHub({ token, branch, catalog, owner, reload, onBranchSaved }: {
  token: string; branch: Branch; catalog: AdminCatalog; owner: boolean;
  reload: () => Promise<void>;
  onBranchSaved: (id: string, created: boolean) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Setting | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const { width } = useWindowDimensions();
  const mobile = width < 640;
  useEffect(() => { setSelected(null); setDirty(false); setConfirmClose(false); }, [branch.id]);
  const close = () => {
    if (dirty) { setConfirmClose(true); return; }
    setSelected(null);
  };
  const forceClose = () => { setSelected(null); setDirty(false); setConfirmClose(false); };
  const open = (id: Setting) => { setSelected(id); setDirty(false); setConfirmClose(false); };
  const current = items.find(item => item.id === selected);

  return <View style={s.page}>
    <Text style={s.title}>Thiết lập</Text>
    <Text style={s.note}>Chạm biểu tượng để mở cài đặt. Mỗi chức năng được quản lý độc lập.</Text>
    <View style={s.grid}>
      {items.filter(item => owner || !item.owner).map(item =>
        <Pressable key={item.id} accessibilityRole="button"
          accessibilityLabel={"Mở " + item.label}
          onPress={() => open(item.id)}
          style={({ pressed }) => [s.tile, pressed && s.pressed]}>
          <View style={s.iconWrap}><Icon name={item.icon} size={25} color={c.red} /></View>
          <Text style={s.tileLabel}>{item.label}</Text>
          <Text style={s.tileHint} numberOfLines={2}>{item.hint}</Text>
        </Pressable>)}
    </View>
    {!owner && <Notice text="Chỉ chủ cửa hàng có quyền thay đổi thông tin chi nhánh, nhận đơn và phí giao. Quản lý có thể cấu hình giờ bán nếu được API cho phép." />}
    <Modal visible={selected !== null} animationType="slide" transparent
      onRequestClose={close}>
      <KeyboardAvoidingView style={[s.overlay, !mobile && s.desktopOverlay]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={StyleSheet.absoluteFill}
          accessibilityLabel="Đóng cửa sổ thiết lập"
          onPress={close} />
        <SafeAreaView edges={["bottom"]} style={[s.sheet, !mobile && s.desktopSheet]}>
          <View style={s.sheetHead}>
            <View style={s.sheetHeading}>
              {current && <Icon name={current.icon} size={21} color={c.red} />}
              <Text style={s.sheetTitle}>{current?.label ?? "Thiết lập"}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Đóng popup"
              onPress={close} style={s.close}>
              <Icon name="close" size={19} color={c.secondary} />
            </Pressable>
          </View>
          <ScrollView style={s.body} contentContainerStyle={s.bodyContent}
            keyboardShouldPersistTaps="handled" nestedScrollEnabled
            showsVerticalScrollIndicator={false}>
            {selected === "branch" && <BranchPanel key={branch.id} token={token}
              branch={branch} mode="details" onDirtyChange={setDirty}
              onSaved={async (id, created) => {
                await onBranchSaved(id, created); forceClose();
              }} />}
            {selected === "create" && <BranchPanel token={token}
              onDirtyChange={setDirty} onSaved={async (id, created) => {
                await onBranchSaved(id, created); forceClose();
              }} />}
            {selected === "status" && <BranchPanel key={branch.id} token={token}
              branch={branch} mode="status" onSaved={async (id, created) => {
                await onBranchSaved(id, created); forceClose();
              }} />}
            {selected === "hours" && <HoursPanel key={catalog.id} catalog={catalog}
              token={token} reload={reload} onDirtyChange={setDirty} />}
            {selected === "delivery" && <DeliveryPolicyPanel key={branch.id + ":delivery"}
              token={token} branchId={branch.id} active={branch.isActive}
              mode="delivery" onDirtyChange={setDirty} />}
            {selected === "orders" && <DeliveryPolicyPanel key={branch.id + ":orders"}
              token={token} branchId={branch.id} active={branch.isActive}
              mode="orders" onDirtyChange={setDirty} />}
          </ScrollView>
          <View style={s.footer}>
            <Pressable accessibilityRole="button" onPress={close}
              style={s.footerButton}>
              <Text style={s.footerText}>Đóng</Text>
            </Pressable>
          </View>
          {confirmClose && <View style={s.confirmBackdrop}>
            <View style={s.confirm}>
              <Text style={s.confirmTitle}>Bỏ thay đổi chưa lưu?</Text>
              <Text style={s.note}>Thông tin bạn vừa chỉnh sửa sẽ không được lưu lên máy chủ.</Text>
              <View style={s.confirmActions}>
                <Action label="Tiếp tục sửa" secondary onPress={() => setConfirmClose(false)} />
                <Action label="Bỏ thay đổi" dangerous onPress={forceClose} />
              </View>
            </View>
          </View>}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}

const s = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 28, gap: 9 },
  title: { fontSize: font.title, fontWeight: "800", color: c.ink },
  note: { fontSize: font.note, lineHeight: 19, color: c.secondary },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -5, marginTop: 12 },
  tile: { width: "33.3333%", minHeight: 126, paddingHorizontal: 5, paddingVertical: 8,
    alignItems: "center", gap: 6, justifyContent: "flex-start" },
  iconWrap: { height: 55, width: 55, alignItems: "center", justifyContent: "center",
    borderRadius: 15, backgroundColor: c.soft },
  tileLabel: { fontSize: font.body, fontWeight: "700", color: c.ink, textAlign: "center" },
  tileHint: { fontSize: font.caption, lineHeight: 14, textAlign: "center", color: c.secondary },
  pressed: { opacity: 0.62 },
  overlay: { flex: 1, justifyContent: "flex-end",
    backgroundColor: "rgba(10, 16, 22, 0.48)" },
  desktopOverlay: { justifyContent: "center", alignItems: "center", padding: 20 },
  sheet: { backgroundColor: c.white, width: "100%", maxHeight: "92%",
    borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: "hidden" },
  desktopSheet: { maxWidth: 590, maxHeight: "90%", borderRadius: 17 },
  sheetHead: { minHeight: 57, paddingHorizontal: 17,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderBottomWidth: 1, borderBottomColor: c.line },
  sheetHeading: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  sheetTitle: { color: c.ink, fontSize: font.section, fontWeight: "800" },
  close: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  body: { minHeight: 0, flexShrink: 1 },
  bodyContent: { padding: 16, paddingBottom: 22 },
  footer: { borderTopWidth: 1, borderTopColor: c.line, padding: 12, flexDirection: "row",
    justifyContent: "flex-end" },
  footerButton: { minWidth: 88, minHeight: 44, paddingHorizontal: 18,
    alignItems: "center", justifyContent: "center" },
  footerText: { fontSize: font.action, color: c.secondary, fontWeight: "700" },
  confirmBackdrop: { ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10,16,22,0.54)", alignItems: "center",
    justifyContent: "center", padding: 18 },
  confirm: { backgroundColor: c.white, borderRadius: 14,
    padding: 20, width: "100%", maxWidth: 390, gap: 14 },
  confirmTitle: { fontSize: font.section, fontWeight: "800", color: c.ink },
  confirmActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" },
});
