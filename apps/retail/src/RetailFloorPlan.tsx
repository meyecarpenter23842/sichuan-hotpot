import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Area, Table } from "./pos-api";

// Persist physical positions by table UUID, not array index or order.
// Six columns remain stable across phone/tablet/desktop; small screens scroll
// horizontally rather than silently changing the meaning of saved coordinates.
export const FLOOR_COLUMNS = 6;
export const FLOOR_MAX_ROWS = 20;

export function floorStatus(table: Table): "pending" | "occupied" | "cleaning" | "free" | "disabled" {
  if ((table.sessions[0]?._count.tickets ?? 0) > 0) return "pending";
  if (table.sessions.length > 0) return "occupied";
  if (table.needsCleaning) return "cleaning";
  return table.isActive ? "free" : "disabled";
}

export function floorLabel(status: ReturnType<typeof floorStatus>): string {
  return {
    pending: "Chờ duyệt QR",
    occupied: "Đang phục vụ",
    cleaning: "Chờ dọn",
    free: "Trống",
    disabled: "Tạm khóa",
  }[status];
}

export function hasFloorPosition(table: Table): boolean {
  return Number.isInteger(table.floorRow) && Number.isInteger(table.floorColumn)
    && table.floorRow !== null && table.floorColumn !== null
    && table.floorRow >= 0 && table.floorRow < FLOOR_MAX_ROWS
    && table.floorColumn >= 0 && table.floorColumn < FLOOR_COLUMNS;
}

type Props = {
  areas: Area[];
  tables: Table[];
  areaId: string | null;
  setAreaId: (areaId: string) => void;
  role: string;
  online: boolean;
  onView: (table: Table) => void;
  onMove: (table: Table, row: number | null, column: number | null) => Promise<boolean>;
};

const palette = {
  free: ["#E6F4EC", "#278154"],
  occupied: ["#FFF0D9", "#9C5517"],
  pending: ["#FDE4E2", "#AB3437"],
  cleaning: ["#F9E8C7", "#8C6B1D"],
  disabled: ["#ECEAE7", "#736D67"],
} as const;

export function RetailFloorPlan({ areas, tables, areaId, setAreaId, role, online, onView, onMove }: Props) {
  const editable = role === "OWNER" || role === "MANAGER";
  const activeArea = areas.find(a => a.id === areaId && a.isActive) ?? areas.find(a => a.isActive);
  const visible = useMemo(() => tables.filter(t => t.areaId === activeArea?.id
    && (t.isActive || t.sessions.length > 0 || t.needsCleaning)), [tables, activeArea?.id]);
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [extraRows, setExtraRows] = useState(4);
  const selected = visible.find(t => t.id === selectedId) ?? null;
  const positions = useMemo(() => new Map(visible.filter(hasFloorPosition)
    .map(t => [String(t.floorRow) + ":" + String(t.floorColumn), t] as const)), [visible]);
  const unplaced = visible.filter(t => !hasFloorPosition(t));
  const rows = Math.max(4, Math.min(FLOOR_MAX_ROWS, extraRows,
    Math.max(Math.ceil(visible.length / FLOOR_COLUMNS) + 1,
      ...visible.filter(hasFloorPosition).map(t => (t.floorRow ?? 0) + 2))));
  const counters = { free: 0, occupied: 0, pending: 0, cleaning: 0, disabled: 0 };
  visible.forEach(t => { counters[floorStatus(t)]++; });

  async function place(row: number | null, column: number | null) {
    if (!selected || !editing || moving || !online || !editable) return;
    if (row === selected.floorRow && column === selected.floorColumn) return;
    setMoving(true);
    try {
      const saved = await onMove(selected, row, column);
      if (saved) setSelectedId(null);
    } finally { setMoving(false); }
  }

  const tile = (table: Table) => {
    const status = floorStatus(table);
    const [bg, ink] = palette[status];
    const chosen = selectedId === table.id && editing;
    return <Pressable key={table.id} testID={"floor-table-" + table.id} accessibilityRole="button"
      accessibilityState={{ selected: chosen }}
      accessibilityLabel={table.name + ", " + floorLabel(status) +
        (editing ? ", chọn để đổi vị trí" : ", mở bàn")}
      onPress={() => { if (editing) setSelectedId(table.id); else onView(table); }}
      style={[styles.table, { backgroundColor: bg, borderColor: chosen ? "#80262D" : ink },
        chosen && styles.chosen]}>
      <Text numberOfLines={1} style={[styles.tableCode, { color: ink }]}>{table.code}</Text>
      <Text numberOfLines={1} style={styles.tableName}>{table.name}</Text>
      <Text numberOfLines={1} style={[styles.tableStatus, { color: ink }]}>
        {status === "pending" ? (table.sessions[0]?._count.tickets ?? 0) + " QR chờ" : floorLabel(status)}
      </Text>
    </Pressable>;
  };

  return <View testID="retail-floor-plan" style={styles.root}>
    <View style={styles.heading}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title}>Sơ đồ bàn</Text>
        <Text style={styles.subtitle}>Sắp xếp theo vị trí thật · chạm bàn để mở nghiệp vụ</Text>
      </View>
      {editable && <Pressable testID="floor-edit-toggle" accessibilityRole="button"
        accessibilityState={{ selected: editing, disabled: moving || !online }}
        disabled={moving || !online}
        onPress={() => { setEditing(v => !v); setSelectedId(null); }}
        style={[styles.editButton, editing && styles.editOn]}>
        <Text style={[styles.editText, editing && styles.editTextOn]}>
          {editing ? "Xong" : "Sắp xếp"}</Text>
      </Pressable>}
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.areaTabs}>
      {areas.filter(a => a.isActive).map(a =>
        <Pressable key={a.id} accessibilityRole="button"
          accessibilityState={{ selected: activeArea?.id === a.id }}
          onPress={() => { setAreaId(a.id); setSelectedId(null); }}
          style={[styles.area, activeArea?.id === a.id && styles.areaOn]}>
          <Text style={[styles.areaText, activeArea?.id === a.id && styles.areaTextOn]}>{a.name}</Text>
        </Pressable>)}
    </ScrollView>
    <View style={styles.legend}>
      {(["free", "occupied", "pending", "cleaning"] as const).map(status =>
        <View key={status} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: palette[status][1] }]}/>
          <Text style={styles.legendText}>{floorLabel(status)} · {counters[status]}</Text>
        </View>)}
    </View>
    {!online && <Text style={styles.warning}>Đang ngoại tuyến. Có thể xem sơ đồ đã tải, nhưng không thể đổi vị trí.</Text>}
    {editing && <View style={styles.hint}>
      <Text style={styles.hintText}>{selected ? "Đã chọn " + selected.name +
        ". Chạm ô trống để chuyển bàn. Có thể bỏ xếp bên dưới." :
        "Chọn một bàn trên sơ đồ hoặc danh sách chưa xếp, sau đó chạm ô trống."}</Text>
      {!!selected && hasFloorPosition(selected) &&
        <Pressable disabled={moving || !online} accessibilityRole="button" accessibilityLabel={"Bỏ vị trí của " + selected.name}
          style={styles.clearButton} onPress={() => { void place(null, null); }}>
          <Text style={styles.clearText}>Bỏ vị trí</Text>
        </Pressable>}
    </View>}
    {!activeArea ? <Text style={styles.warning}>Chưa có khu vực hoạt động. Hãy tạo khu vực trong Admin.</Text> : <>
      <ScrollView horizontal showsHorizontalScrollIndicator persistentScrollbar
        style={styles.boardScroll} contentContainerStyle={styles.boardWrap}>
        <View testID="floor-board" style={styles.board}>
          {Array.from({ length: rows }, (_, row) =>
            <View key={row} style={styles.boardRow}>
              {Array.from({ length: FLOOR_COLUMNS }, (_, column) => {
                const table = positions.get(String(row) + ":" + String(column));
                return <View key={column} style={styles.slot}>
                  {table ? tile(table) : <Pressable testID={"floor-slot-" + row + "-" + column}
                    accessibilityRole="button"
                    accessibilityLabel={"Vị trí hàng " + (row + 1) + " cột " + (column + 1) +
                      (editing && selected ? ", đặt " + selected.name : ", còn trống")}
                    disabled={!editing || !selected || moving || !online}
                    onPress={() => { void place(row, column); }}
                    style={[styles.emptySlot, editing && selected && styles.targetSlot]}>
                    <Text style={styles.emptyText}>{editing && selected ? "+" : "·"}</Text>
                  </Pressable>}
                </View>;
              })}
            </View>)}
        </View>
      </ScrollView>
      <View style={styles.boardHelp}>
        <Text style={styles.scrollHint}>Sơ đồ có thể vuốt ngang trên màn hình nhỏ. Vị trí đã lưu không đổi giữa các thiết bị.</Text>
        {editing && rows < FLOOR_MAX_ROWS && <Pressable accessibilityRole="button"
          disabled={moving || !online} style={styles.addRows}
          onPress={() => setExtraRows(v => Math.min(FLOOR_MAX_ROWS, Math.max(v, rows) + 2))}>
          <Text style={styles.clearText}>+ Thêm hàng</Text>
        </Pressable>}
      </View>
      <View style={styles.unplacedHead}>
        <Text style={styles.unplacedTitle}>Bàn chưa xếp vị trí ({unplaced.length})</Text>
        <Text style={styles.legendText}>{editing ? "Chọn bàn để đặt lên sơ đồ" : "Vẫn có thể chạm để mở bàn"}</Text>
      </View>
      {unplaced.length > 0 ? <View style={styles.unplaced}>{unplaced.map(tile)}</View> :
        <Text style={styles.allPlaced}>Tất cả bàn trong khu vực đã có vị trí.</Text>}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  root: { padding: 12, gap: 12, backgroundColor: "#FFFFFF", borderRadius: 12 },
  heading: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 18, color: "#302321", fontWeight: "900" },
  subtitle: { color: "#81736C", fontSize: 12, lineHeight: 18 },
  editButton: { minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: 8,
    borderWidth: 1, borderColor: "#8D2C33", backgroundColor: "#FFFFFF" },
  editOn: { backgroundColor: "#8D2C33" },
  editText: { color: "#8D2C33", fontWeight: "800" },
  editTextOn: { color: "#FFFFFF" },
  areaTabs: { gap: 7, paddingVertical: 2 },
  area: { minHeight: 44, paddingHorizontal: 14, borderRadius: 9, borderColor: "#EAE1DA",
    borderWidth: 1, justifyContent: "center" },
  areaOn: { backgroundColor: "#FCE8E8", borderColor: "#A72D37" },
  areaText: { fontWeight: "700", color: "#302321", fontSize: 13 },
  areaTextOn: { color: "#942B35" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { height: 8, width: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: "#736761" },
  warning: { color: "#852831", backgroundColor: "#FFEBE8", padding: 10, borderRadius: 7 },
  hint: { padding: 10, backgroundColor: "#F7F0E7", borderRadius: 8, flexDirection: "row",
    gap: 10, justifyContent: "space-between", alignItems: "center" },
  hintText: { color: "#40312C", flex: 1, fontSize: 12, lineHeight: 19 },
  clearButton: { minHeight: 44, paddingHorizontal: 10, justifyContent: "center",
    backgroundColor: "#FFFFFF", borderRadius: 7 },
  clearText: { color: "#942B35", fontWeight: "800" },
  boardScroll: { minWidth: 0 },
  boardWrap: { padding: 2 },
  board: { backgroundColor: "#FAF7F3", padding: 9, borderRadius: 12,
    borderWidth: 1, borderColor: "#EAE1DA", gap: 7 },
  boardRow: { flexDirection: "row", gap: 7 },
  slot: { width: 99, height: 88 },
  table: { width: 99, minHeight: 88, borderWidth: 1.5, borderRadius: 10,
    justifyContent: "center", alignItems: "center", gap: 3, padding: 6 },
  chosen: { borderWidth: 3 },
  tableCode: { fontSize: 16, fontWeight: "900" },
  tableName: { fontSize: 10, color: "#3C332E", maxWidth: "100%" },
  tableStatus: { fontSize: 10, fontWeight: "700" },
  emptySlot: { width: 99, height: 88, borderStyle: "dashed", borderWidth: 1.4,
    borderColor: "#E2D9D2", borderRadius: 10, alignItems: "center", justifyContent: "center" },
  targetSlot: { backgroundColor: "#E9F5ED", borderColor: "#248057" },
  emptyText: { fontSize: 21, color: "#9E9189" },
  scrollHint: { fontSize: 11, color: "#81736C", flexShrink: 1 },
  boardHelp: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  addRows: { minHeight: 44, paddingHorizontal: 10, backgroundColor: "#FAF0E8", borderRadius: 8, justifyContent: "center" },
  unplacedHead: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7 },
  unplacedTitle: { fontWeight: "800", fontSize: 13, color: "#302321" },
  unplaced: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  allPlaced: { color: "#287C5C", fontSize: 12 },
});
