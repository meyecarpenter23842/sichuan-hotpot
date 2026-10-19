import React, { useMemo, useState } from "react";
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet,
  Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ADMIN_CATALOG_VERSION, provinceByCode, provinces, searchAdministrativeAreas,
  wardByCode, type AdministrativeArea } from "../../shared/src/vietnam-admin";
import { selectableWardsForProvince, isWardAllowedForNewDelivery } from "../../shared/src/tien-giang-service-area";

type Choice = { code: string; name: string };
type SelectModalProps = {
  title: string; values: readonly Choice[]; selected: readonly string[];
  multiple?: boolean; onChoose: (codes: string[]) => void; onDismiss: () => void;
};
/** A true modal/portal, never a layout-flow dropdown pushing the form down. */
function SelectModal({ title, values, selected, multiple = false, onChoose, onDismiss }: SelectModalProps) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string[]>([...selected]);
  const filtered = useMemo(() => searchAdministrativeAreas(values, query, 300), [values, query]);
  function select(code: string) {
    if (!multiple) { onChoose([code]); onDismiss(); return; }
    setDraft(old => old.includes(code) ? old.filter(x => x !== code) : [...old, code]);
  }
  return <Modal transparent animationType="fade" visible onRequestClose={onDismiss}>
    <KeyboardAvoidingView style={s.scrim} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Pressable accessibilityRole="button" accessibilityLabel="Đóng danh sách địa giới"
        style={StyleSheet.absoluteFill} onPress={onDismiss} />
      <SafeAreaView edges={["bottom"]} style={s.dialog}>
        <View style={s.header}>
          <Text style={s.title}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Đóng danh sách"
            style={s.close} onPress={onDismiss}><Text style={s.closeText}>✕</Text></Pressable>
        </View>
        <TextInput style={s.search} autoCorrect={false} autoCapitalize="none"
          accessibilityLabel={"Tìm " + title}
          value={query} onChangeText={setQuery} placeholder="Tìm tên hoặc mã..."
          placeholderTextColor="#79808A" />
        <FlatList data={filtered} keyExtractor={item => item.code}
          keyboardShouldPersistTaps="always"
          initialNumToRender={14} maxToRenderPerBatch={20} windowSize={5}
          ListEmptyComponent={<Text style={s.empty}>Không tìm thấy. Hãy thử tên hoặc mã khác.</Text>}
          renderItem={({item}) => <Pressable accessibilityRole={multiple ? "checkbox" : "radio"}
            accessibilityState={{ checked: (multiple ? draft : selected).includes(item.code) }}
            accessibilityLabel={item.name + " (" + item.code + ")"}
            style={s.option} onPress={() => select(item.code)}>
            <Text style={s.optionText} numberOfLines={2}>{item.name}</Text>
            <Text style={s.code}>{item.code}</Text>
            {(multiple ? draft : selected).includes(item.code) &&
              <Text style={s.tick}>✓</Text>}
          </Pressable>} />
        {multiple && <View style={s.footer}>
          <Text style={s.count}>{draft.length} mục đã chọn</Text>
          <Pressable accessibilityRole="button" style={s.confirm}
            onPress={() => { onChoose(draft); onDismiss(); }}>
            <Text style={s.confirmText}>Áp dụng</Text>
          </Pressable>
        </View>}
      </SafeAreaView>
    </KeyboardAvoidingView>
  </Modal>;
}
export function VietnamAdministrativeAreaPicker({ provinceCode, wardCode, onChange, showWardSelect = true, disabled = false }: {
  provinceCode: string | null; wardCode: string | null;
  onChange: (provinceCode: string | null, wardCode: string | null) => void;
  showWardSelect?: boolean; disabled?: boolean;
}) {
  const [open, setOpen] = useState<"province" | "ward" | null>(null);
  const province = provinceByCode(provinceCode);
  const ward = wardByCode(wardCode);
  const wards = useMemo(() => province ? selectableWardsForProvince(province.code) : [], [province?.code]);
  const validWard = !!ward && ward.provinceCode === provinceCode;
  return <View style={s.picker}>
    <Text style={s.label}>Tỉnh/Thành phố *</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Chọn Tỉnh/Thành phố"
      disabled={disabled} style={s.field} onPress={() => setOpen("province")}>
      <Text style={[s.fieldText, !province && s.placeholder]}>
        {province?.name ?? "Chọn tỉnh/thành phố"}</Text><Text style={s.arrow}>⌄</Text>
    </Pressable>
    {showWardSelect && <>
      <Text style={s.label}>Phường/Xã/Đặc khu *</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Chọn Phường/Xã/Đặc khu"
        disabled={disabled || !province} style={[s.field, !province && s.inactive]}
        onPress={() => setOpen("ward")}>
        <Text style={[s.fieldText, !validWard && s.placeholder]}>
          {validWard ? ward?.name : "Chọn phường/xã/đặc khu"}</Text><Text style={s.arrow}>⌄</Text>
      </Pressable>
    </>}
    {provinceCode === "82" && wardCode && !isWardAllowedForNewDelivery(provinceCode, wardCode) &&
      <Text style={s.warning}>Địa chỉ này thuộc Đồng Tháp cũ, không nằm trong vùng giao mới. Hãy chọn xã/phường khác.</Text>}
    {!!open && <SelectModal key={open + ":" + provinceCode}
      title={open === "province" ? "Tỉnh/Thành phố" : "Phường/Xã/Đặc khu"}
      values={open === "province" ? provinces : wards}
      selected={open === "province" ? (provinceCode ? [provinceCode] : []) :
        (validWard && wardCode ? [wardCode] : [])}
      onChoose={codes => {
        if (open === "province") {
          // Province change atomically discards an old ward from a different province.
          onChange(codes[0] ?? null, codes[0] === provinceCode ? wardCode : null);
        } else onChange(provinceCode, codes[0] ?? null);
      }}
      onDismiss={() => setOpen(null)} />}
    <Text style={s.version}>Danh mục {ADMIN_CATALOG_VERSION} · GPS chỉ hỗ trợ định vị</Text>
  </View>;
}
export function VietnamWardMultiPicker({ provinceCode, selected, onChange, disabled = false }: {
  provinceCode: string | null; selected: string[]; onChange: (codes: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const values = useMemo(() => provinceCode ? selectableWardsForProvince(provinceCode) : [], [provinceCode]);
  const valid = selected.filter(code => values.some(v => v.code === code));
  const excludedCount = selected.length - valid.length;
  return <View style={s.picker}>
    <Text style={s.label}>Các phường/xã cùng mức phí</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Chọn các phường/xã"
      style={[s.field, (!provinceCode || disabled) && s.inactive]}
      disabled={!provinceCode || disabled} onPress={() => setOpen(true)}>
      <Text style={s.fieldText}>{valid.length ? valid.length + " phường/xã đã chọn" :
        "Chọn phường (để trống nếu áp dụng toàn tỉnh)"}</Text><Text style={s.arrow}>⌄</Text>
    </Pressable>
    {excludedCount > 0 && <Text style={s.warning}>{excludedCount} mã thuộc vùng đã ngừng phục vụ vẫn còn trong chính sách cũ. Chọn lại và lưu chính sách mới để loại bỏ.</Text>}
    {open && <SelectModal title="Các phường/xã" values={values} selected={valid}
      multiple onChoose={onChange} onDismiss={() => setOpen(false)} />}
  </View>;
}
const s = StyleSheet.create({
  picker: { gap: 7 },
  label: { fontSize: 12, fontWeight: "700", color: "#282E38" },
  field: { minHeight: 44, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9,
    borderWidth: 1, borderColor: "#DCE0E6", backgroundColor: "#FFFFFF",
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  fieldText: { fontSize: 13, color: "#202934", flexShrink: 1 },
  placeholder: { color: "#737B87" }, inactive: { opacity: 0.5 },
  arrow: { color: "#B3262D", fontSize: 18 }, version: { fontSize: 11, color: "#78808B" },
  scrim: { flex: 1, justifyContent: "center", backgroundColor: "rgba(13,20,30,.54)",
    padding: 14 }, dialog: { maxWidth: 520, width: "100%", maxHeight: "80%", minHeight: 260,
      alignSelf: "center", backgroundColor: "#FFFFFF", borderRadius: 16, overflow: "hidden" },
  header: { paddingHorizontal: 14, paddingTop: 9, paddingBottom: 5,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 15, fontWeight: "800", color: "#202934", flex: 1 },
  close: { width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  closeText: { fontSize: 17, color: "#202934" },
  search: { marginHorizontal: 14, marginBottom: 8, minHeight: 44, borderWidth: 1,
    borderColor: "#CED4DE", borderRadius: 9, paddingHorizontal: 12, fontSize: 14 },
  option: { minHeight: 46, paddingHorizontal: 14, borderBottomColor: "#EEF0F3",
    borderBottomWidth: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  optionText: { flex: 1, fontSize: 13, color: "#252D35" },
  code: { fontSize: 11, color: "#79818B" }, tick: { color: "#B3262D", fontWeight: "800" },
  empty: { padding: 20, fontSize: 13, color: "#66717B" },
  warning: { fontSize: 12, lineHeight: 18, color: "#A34213" },
  footer: { flexDirection: "row", padding: 12, justifyContent: "space-between", alignItems: "center",
    borderTopWidth: 1, borderTopColor: "#EDEFF3" },
  count: { fontSize: 12, color: "#5B6370" },
  confirm: { backgroundColor: "#B3262D", borderRadius: 9, minHeight: 44,
    justifyContent: "center", paddingHorizontal: 20 },
  confirmText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
});
