import React, { useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { tableQrMatrix, tableQrSvg, tableQrUrl } from "./table-qr.mjs";
import { c } from "./theme";

export interface PrintTable { name: string; code: string; qrHandle: string; }
export function TableQrPreview({ table }: { table: PrintTable }) {
  const url = useMemo(() => tableQrUrl(table.qrHandle), [table.qrHandle]);
  const matrix = useMemo(() => tableQrMatrix(url), [url]);
  const svg = useMemo(() => tableQrSvg(url), [url]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const basename = "QR-" + table.code.replace(/[^A-Za-z0-9_-]/g, "-");
  const download = async () => {
    setBusy(true); setMessage("");
    try {
      if (Platform.OS === "web" && typeof document !== "undefined") {
        const blob = new Blob([svg], { type: "image/svg+xml" });
        const href = URL.createObjectURL(blob);
        try {
          const a = document.createElement("a");
          a.href = href; a.download = basename + ".svg";
          document.body.appendChild(a); a.click(); a.remove();
        } finally { setTimeout(() => URL.revokeObjectURL(href), 1000); }
      } else if (Platform.OS === "android") {
        const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!permission.granted) return;
        const target = await FileSystem.StorageAccessFramework.createFileAsync(
          permission.directoryUri, basename, "image/svg+xml");
        await FileSystem.writeAsStringAsync(target, svg, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      } else {
        throw new Error("Thiết bị chưa hỗ trợ lưu SVG.");
      }
      setMessage("Đã lưu mã QR để in tem.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không lưu được mã QR.");
    } finally { setBusy(false); }
  };
  const print = () => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const popup = window.open("", "_blank", "width=520,height=650");
    if (!popup) { setMessage("Trình duyệt đang chặn cửa sổ in."); return; }
    popup.opener = null;
    popup.document.open();
    popup.document.write("<!doctype html><html><head><meta charset='utf-8'><title>Tem QR bàn</title><style>body{font-family:Arial,sans-serif;text-align:center;margin:28px}svg{width:72mm;height:72mm;max-width:100%}h2{font-size:20px}p{font-size:12px;overflow-wrap:anywhere}@media print{body{margin:8mm}}</style></head><body><h2 id='label'></h2><div id='qr'></div><p id='url'></p></body></html>");
    popup.document.close();
    const heading = popup.document.getElementById("label");
    const qr = popup.document.getElementById("qr");
    const address = popup.document.getElementById("url");
    if (heading) heading.textContent = "Lẩu Tứ Xuyên • " + table.name;
    if (qr) qr.innerHTML = svg;
    if (address) address.textContent = url;
    popup.focus(); popup.print();
  };
  return <View style={s.box}>
    <Text style={s.heading}>QR cố định • {table.name}</Text>
    <View style={s.qrWrapper} accessibilityLabel={"Mã QR của " + table.name}>
      <View style={s.qrGrid}>
        {matrix.map((row, yi) => <View key={yi} style={s.qrRow}>
          {row.map((dark, xi) => <View key={xi} style={[s.pixel, dark && s.pixelDark]} />)}
        </View>)}
      </View>
    </View>
    <Text selectable style={s.url}>{url}</Text>
    <Text style={s.hint}>Mã QR dùng để nhận diện bàn. Khách chỉ gửi yêu cầu món khi nhân viên đã mở phiên; món QR phải được duyệt.</Text>
    <View style={s.actions}>
      <Pressable accessibilityRole="button" disabled={busy} style={s.button}
        onPress={() => { void download(); }}>
        {busy ? <ActivityIndicator color={c.white} /> : <Text style={s.buttonText}>Lưu SVG</Text>}
      </Pressable>
      {Platform.OS === "web" && <Pressable accessibilityRole="button" style={s.secondary}
        onPress={print}><Text style={s.secondaryText}>In tem</Text></Pressable>}
    </View>
    {!!message && <Text accessibilityRole="alert" style={s.hint}>{message}</Text>}
  </View>;
}
const s = StyleSheet.create({
  box: { gap: 12, alignItems: "center", padding: 14, borderRadius: 14,
    backgroundColor: c.white, borderWidth: 1, borderColor: c.line },
  heading: { fontSize: 17, fontWeight: "800", color: c.ink, textAlign: "center" },
  qrWrapper: { width: 232, height: 232, padding: 20, backgroundColor: "white",
    borderRadius: 10, borderWidth: 1, borderColor: "#DDD" },
  qrGrid: { flex: 1, backgroundColor: "white" },
  qrRow: { flex: 1, flexDirection: "row" },
  pixel: { flex: 1, backgroundColor: "white" },
  pixelDark: { backgroundColor: "black" },
  url: { fontSize: 12, color: c.ink, textAlign: "center", lineHeight: 19 },
  hint: { fontSize: 12, lineHeight: 18, color: c.secondary, textAlign: "center" },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  button: { minHeight: 44, minWidth: 120, backgroundColor: c.red, borderRadius: 9,
    paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  buttonText: { color: c.white, fontWeight: "800", fontSize: 14 },
  secondary: { minHeight: 44, minWidth: 120, borderWidth: 1, borderColor: c.red,
    borderRadius: 9, justifyContent: "center", alignItems: "center", paddingHorizontal: 18 },
  secondaryText: { color: c.red, fontWeight: "800", fontSize: 14 },
});
