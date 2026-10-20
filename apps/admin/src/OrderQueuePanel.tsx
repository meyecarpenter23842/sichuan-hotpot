import { displayAdministrativeSelection } from "../../../packages/shared/src/vietnam-admin";
import { orderCustomerCallUrl, orderCustomerDirectionsUrl } from "../../../packages/shared/src/order-contact";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, AppState, Image, Linking, Modal, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Field, Notice, Action, Pill } from "./ui";
import { Icon } from "./Icon";
import {
  imageUrl, request, type AdminCatalog, type CatalogComboGroup, type CatalogGroup, type CatalogProduct,
} from "./api";
import { watchOrderEvents } from "./order-realtime";
import { c, font } from "./theme";
import { adminDensity } from "./density";
import { HistoryDateFilter } from "./HistoryDateFilter";
import { validHistoryCode, type HistoryRange } from "./history-search";
import type { ReportMetric } from "./BusinessReportPanel";

export type OrderStatus =
  "PENDING" | "CONFIRMED" | "PREPARING" | "READY" |
  "DELIVERING" | "DELIVERED" | "CANCELED" | "DELIVERY_FAILED";
type ActionStatus =
  "CONFIRMED" | "CANCELED" | "PREPARING" | "READY" |
  "DELIVERING" | "DELIVERED" | "DELIVERY_FAILED";
type EditLine = {
  key: string; productId: string; variantId: string | null;
  modifierIds: string[]; comboOptionIds: string[];
  quantity: number; pricingMode?: "SEPARATE";
};

export interface StaffOrder {
  id: string; branchId: string; status: OrderStatus; createdAt: string; updatedAt: string;
  customerNote?: string | null;
  subtotalVnd?: number; deliveryFeeVnd?: number; totalVnd?: number;
  payment?: { method: "COD" | "QR"; status: string; amountVnd?: number } | null;
  items: {
    id?: string; productId?: string | null; variantId?: string | null;
    pricingMode?: "LEGACY" | "SEPARATE";
    productName: string; variantName: string | null; quantity: number;
    unitPriceVnd?: number; lineTotalVnd?: number;
    modifiers: { optionId?: string | null; name: string; priceVnd?: number }[];
    comboItems: {
      productId?: string | null; variantId?: string | null; modifierOptionId?: string | null;
      kind: "FIXED" | "CHOICE"; groupName?: string | null;
      productName: string; variantName?: string | null;
      quantity: number; priceDeltaVnd?: number; sortOrder?: number;
    }[];
  }[];
}
interface OrderDetail extends StaffOrder {
  deliveryAssignment?: { driverId: string } | null;
  phoneSnapshot?: string | null; addressLineSnapshot?: string | null;
  latitudeSnapshot?: string | null; longitudeSnapshot?: string | null;
  roadDistanceMeters?: number | null;
  zoneNameSnapshot?: string | null; provinceCodeSnapshot?: string | null;
  wardCodeSnapshot?: string | null; catalogVersionSnapshot?: string | null;
  statusHistory: {
    fromStatus: OrderStatus | null; toStatus: OrderStatus;
    createdAt: string; reason: string | null; source: "CUSTOMER" | "SHOP" | "UNKNOWN";
  }[];
  edits?: {
    reason: string; status: OrderStatus; beforeSubtotalVnd: number; afterSubtotalVnd: number;
    beforeTotalVnd: number; afterTotalVnd: number; createdAt: string;
  }[];
}

const statusName: Record<OrderStatus, string> = {
  PENDING: "Đơn mới", CONFIRMED: "Đã nhận", PREPARING: "Đang chế biến",
  READY: "Chờ giao", DELIVERING: "Đang giao", DELIVERED: "Hoàn thành",
  CANCELED: "Đã hủy", DELIVERY_FAILED: "Giao thất bại",
};
// One palette shared by queue rows and order detail. Terminal failure is never green.
const statusTone: Record<OrderStatus, { background: string; text: string }> = {
  PENDING: { background: "#FFE5E9", text: "#B51E2A" },
  CONFIRMED: { background: "#E7F0FF", text: "#205A9A" },
  PREPARING: { background: "#FFF0D7", text: "#8A510B" },
  READY: { background: "#DFF0FF", text: "#205A9A" },
  DELIVERING: { background: "#EEEAFE", text: "#6241A2" },
  DELIVERED: { background: "#DDF4E5", text: "#175A30" },
  CANCELED: { background: "#FDE4E8", text: "#B31E30" },
  DELIVERY_FAILED: { background: "#FFF0D8", text: "#9A4C12" },
};
const cancellationSourceLabel = {
  CUSTOMER: "Khách hủy", SHOP: "Quán hủy / từ chối", UNKNOWN: "Chưa rõ bên hủy",
} as const;
const money = (n: number) => n.toLocaleString("vi-VN") + "đ";
type AdminComboChoice = {
  id: string; sourceType: "PRODUCT" | "TOPPING";
  sourceId: string; name: string; sourceGroupName: string | null;
  variantId: string | null; variantName: string | null;
  quantity: number; priceDeltaVnd: number; isAvailable: boolean;
};
function comboChoices(group: CatalogComboGroup): AdminComboChoice[] {
  return [
    ...group.options.map(option => ({
      id: option.id, sourceType: "PRODUCT" as const, sourceId: option.childProduct.id,
      name: option.childProduct.name, sourceGroupName: null,
      variantId: option.variant?.id ?? null, variantName: option.variant?.name ?? null,
      quantity: option.quantity, priceDeltaVnd: option.priceDeltaVnd,
      isAvailable: option.childProduct.isAvailable
        && (option.variant == null || option.variant.isAvailable),
    })),
    ...(group.modifierOptions ?? []).map(option => ({
      id: option.id, sourceType: "TOPPING" as const, sourceId: option.modifierOption.id,
      name: option.modifierOption.name, sourceGroupName: option.modifierOption.group.name,
      variantId: null, variantName: null, quantity: option.quantity,
      priceDeltaVnd: option.priceDeltaVnd,
      isAvailable: option.modifierOption.isAvailable && option.modifierOption.group.isAvailable,
    })),
  ];
}
const when = (date: string) => new Date(date).toLocaleString("vi-VN", {
  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
});
function availableActions(status: OrderStatus, role: string): { value: ActionStatus; label: string }[] {
  const manager = role === "OWNER" || role === "MANAGER";
  const kitchen = manager || role === "KITCHEN";
  if (status === "PENDING" && manager) return [
    { value: "CONFIRMED", label: "Xác nhận đơn" },
    { value: "CANCELED", label: "Từ chối đơn" },
  ];
  if (status === "CONFIRMED") return [
    ...(kitchen ? [{ value: "PREPARING" as const, label: "Bắt đầu chế biến" }] : []),
    ...(manager ? [{ value: "CANCELED" as const, label: "Hủy đơn" }] : []),
  ];
  if (status === "PREPARING" && kitchen) return [
    { value: "READY", label: "Báo món đã sẵn sàng" },
  ];
  if (status === "READY" && (manager || role === "DRIVER")) return [
    { value: "DELIVERING", label: "Bắt đầu giao" },
  ];
  if (status === "DELIVERING" && (manager || role === "DRIVER")) return [
    { value: "DELIVERED", label: "Đã giao thành công" },
    { value: "DELIVERY_FAILED", label: "Giao thất bại" },
  ];
  if (status === "DELIVERY_FAILED" && (manager || role === "DRIVER")) return [
    { value: "DELIVERING", label: "Giao lại" },
  ];
  return [];
}
export type OrderGroup = "new" | "confirmed" | "preparing" | "ready" | "delivering" | "history";
export type HistoryStatusFilter = "ALL" | "DELIVERED" | "CANCELED" | "DELIVERY_FAILED";
const historyFilters: { value: HistoryStatusFilter; label: string }[] = [
  { value: "ALL", label: "Tất cả" },
  { value: "DELIVERED", label: "Hoàn thành" },
  { value: "CANCELED", label: "Đã hủy" },
  { value: "DELIVERY_FAILED", label: "Giao thất bại" },
];
const orderGroups: { id: Exclude<OrderGroup, "history">; label: string; statuses: OrderStatus[] }[] = [
  { id: "new", label: "Mới", statuses: ["PENDING"] },
  { id: "confirmed", label: "Đã nhận", statuses: ["CONFIRMED"] },
  { id: "preparing", label: "Đang nấu", statuses: ["PREPARING"] },
  { id: "ready", label: "Chờ giao", statuses: ["READY"] },
  { id: "delivering", label: "Đang giao", statuses: ["DELIVERING"] },
];

export function OrderQueuePanel({ token, branchId, role, mode, active, group, onGroupChange,
  onCloseHistory, historyStatus, onHistoryStatusChange,
  historyRange, onHistoryRangeChange, historyCode, onHistoryCodeChange,
  reportMetric, onClearReportMetric }: {
  token: string; branchId: string; role: string; mode: "orders" | "kitchen" | "delivery";
  active: boolean; group: OrderGroup; onGroupChange: (value: OrderGroup) => void;
  onCloseHistory: () => void;
  historyStatus: HistoryStatusFilter;
  onHistoryStatusChange: (value: HistoryStatusFilter) => void;
  historyRange: HistoryRange; onHistoryRangeChange: (value: HistoryRange) => void;
  historyCode: string; onHistoryCodeChange: (value: string) => void;
  reportMetric: ReportMetric | null; onClearReportMetric: () => void;
}) {
  const kitchenOnly = role === "KITCHEN";
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [debouncedCode, setDebouncedCode] = useState(historyCode);
  useEffect(() => {
    if (!historyCode.trim()) { setDebouncedCode(""); return; }
    const timer = setTimeout(() => setDebouncedCode(historyCode.trim()), 400);
    return () => clearTimeout(timer);
  }, [historyCode]);
  const hasCode = debouncedCode.length > 0 && validHistoryCode(debouncedCode);
  const badCode = !!historyCode.trim() && !validHistoryCode(historyCode);
  const searchPending = historyCode.trim() !== debouncedCode.trim();
  const activeLane = mode === "orders"
    ? group === "history" && (hasCode || reportMetric) ? "lookup" : group : mode;
  const [laneOrders, setLaneOrders] = useState<StaffOrder[]>([]);
  // A freshly selected status must never display orders from the previous
  // server query while React waits for the next effect and network response.
  const [loadedLaneUrl, setLoadedLaneUrl] = useState<string | null>(null);
  const [laneCursor, setLaneCursor] = useState<string | null>(null);
  const [laneTotal, setLaneTotal] = useState<number | null>(null);
  const [laneLoading, setLaneLoading] = useState(true);
  const [laneLoadingMore, setLaneLoadingMore] = useState(false);
  const [laneError, setLaneError] = useState("");
  const laneRequest = useRef(0);
  const pagingBusy = useRef(false);
  // Number of visible rows to re-query from the server after a realtime/poll update.
  // Never merge stale client rows from a previous status or filter into refreshed pages.
  const loadedCount = useRef(25);
  const inHistory = mode === "orders" && group === "history";
  const historyQuery = inHistory
    ? (reportMetric ? "&metric=" + encodeURIComponent(reportMetric)
      : hasCode ? "&code=" + encodeURIComponent(debouncedCode.trim().replace(/^#/, ""))
        : historyStatus !== "ALL" ? "&status=" + encodeURIComponent(historyStatus) : "")
      + (historyRange.from && historyRange.to
        ? "&from=" + encodeURIComponent(historyRange.from)
          + "&to=" + encodeURIComponent(historyRange.to) : "") : "";
  const laneUrl = "/admin/orders/" + branchId + "/pages?group="
    + encodeURIComponent(activeLane) + historyQuery;
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [contactError, setContactError] = useState("");
  const [opening, setOpening] = useState(false);
  const [action, setAction] = useState<ActionStatus | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [drivers, setDrivers] = useState<{ userId: string; user: { phoneE164: string | null } }[]>([]);
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [editingOrder, setEditingOrder] = useState(false);
  const [editCatalog, setEditCatalog] = useState<AdminCatalog | null>(null);
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [editReason, setEditReason] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [addingProduct, setAddingProduct] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const requestId = useRef(0);
  const lastIds = useRef<Set<string> | null>(null);
  const pendingAlerts = useRef<Set<string>>(new Set());

  const refreshLane = useCallback(async () => {
    if (!active || (inHistory && (badCode || searchPending))) return;
    const current = ++laneRequest.current;
    setLaneLoading(true);
    try {
      const target = Math.max(25, loadedCount.current);
      const rows: StaffOrder[] = [];
      let cursor: string | null = null;
      let total = 0;
      // Re-fetch the full visible keyset window. A changed status on page 2 must
      // disappear just as reliably as one on page 1.
      do {
        const limit = Math.min(50, target - rows.length);
        const page: { items: StaffOrder[]; nextCursor: string | null; total: number } =
          await request<{ items: StaffOrder[]; nextCursor: string | null; total: number }>(
            laneUrl + "&limit=" + limit + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
            token);
        if (current !== laneRequest.current) return;
        rows.push(...page.items);
        total = page.total;
        cursor = page.nextCursor;
      } while (rows.length < target && cursor);
      if (current !== laneRequest.current) return;
      setLaneOrders(rows);
      setLoadedLaneUrl(laneUrl);
      loadedCount.current = rows.length;
      setLaneCursor(cursor);
      setLaneTotal(total);
      setLaneError("");
    } catch (e) {
      if (current === laneRequest.current)
        setLaneError(e instanceof Error ? e.message : "Không tải được nhóm đơn này.");
    } finally { if (current === laneRequest.current) setLaneLoading(false); }
  }, [active, token, laneUrl, inHistory, badCode, searchPending]);

  const loadMoreLane = async () => {
    if (loadedLaneUrl !== laneUrl || !laneCursor || pagingBusy.current || laneLoading) return;
    pagingBusy.current = true; setLaneLoadingMore(true); setLaneError("");
    const current = laneRequest.current;
    try {
      const page = await request<{ items: StaffOrder[]; nextCursor: string | null; total: number }>(
        laneUrl + "&limit=25&cursor=" + encodeURIComponent(laneCursor), token);
      if (current !== laneRequest.current) return;
      setLaneOrders(prev => {
        const seen = new Set(prev.map(item => item.id));
        const updated = [...prev, ...page.items.filter(item => !seen.has(item.id))];
        loadedCount.current = updated.length;
        return updated;
      });
      setLaneCursor(page.nextCursor);
      setLaneTotal(page.total);
    } catch (e) {
      if (current === laneRequest.current)
        setLaneError(e instanceof Error ? e.message : "Không tải thêm được lịch sử.");
    } finally {
      pagingBusy.current = false;
      setLaneLoadingMore(false);
    }
  };

  useEffect(() => {
    laneRequest.current++;
    loadedCount.current = 25;
    setLaneOrders([]); setLoadedLaneUrl(null);
    setLaneCursor(null); setLaneTotal(null); setLaneError("");
    setLaneLoading(true);
    if (active) void refreshLane();
    return () => { laneRequest.current++; };
  }, [active, refreshLane]);

  const refreshLaneRef = useRef(refreshLane);
  refreshLaneRef.current = refreshLane;
  const sync = useCallback(async () => {
    const current = ++requestId.current;
    setSyncing(true);
    try {
      const fresh = await request<StaffOrder[]>("/admin/orders/" + branchId, token);
      if (current !== requestId.current) return;
      const pending = fresh.filter(x => x.status === "PENDING");
      if (lastIds.current) {
        const newcomers = pending.filter(x => !lastIds.current?.has(x.id));
        const unseen = newcomers.filter(x => {
          if (pendingAlerts.current.has(x.id)) return false;
          pendingAlerts.current.add(x.id);
          return true;
        });
        if (unseen.length) {
          setNotice("Có " + unseen.length + " đơn mới. Kiểm tra và xác nhận.");
        }
      }
      lastIds.current = new Set(pending.map(x => x.id));
      setOrders(fresh); setError("");
      // A socket/poll update refreshes the currently selected lane as well.
      // The callback ref avoids clearing alert state whenever a tab changes.
      void refreshLaneRef.current();
    } catch (e) {
      if (current === requestId.current) {
        setError(e instanceof Error ? e.message : "Mất kết nối. Hãy thử tải lại danh sách đơn.");
      }
    } finally {
      if (current === requestId.current) { setLoading(false); setSyncing(false); }
    }
  }, [branchId, token]);

  useEffect(() => {
    requestId.current++;
    lastIds.current = null;
    pendingAlerts.current.clear();
    setOrders([]); setLoading(true); setNotice(""); setError("");
    if (active) void sync();
    return () => { requestId.current++; };
  }, [active, branchId, sync]);

  useEffect(() => {
    if (!active) return;
    const clockTick = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(clockTick);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      if (AppState.currentState === "active") void sync();
    }, 10000);
    const sub = AppState.addEventListener("change", next => {
      if (next === "active") void sync();
    });
    return () => { clearInterval(interval); sub.remove(); };
  }, [active, sync]);

  useEffect(() => {
    if (!active || !token) return;
    return watchOrderEvents({
      token, branchId,
      onReady: () => { void sync(); },
      onChange: event => {
        if (event.type === "order.overdue" && !kitchenOnly) {
          setNotice("Có đơn chờ xác nhận quá 5 phút. Vui lòng kiểm tra.");
        }
        void sync();
      },
    });
  }, [active, token, branchId, kitchenOnly, sync]);

  const openDetail = async (id: string, quickAction?: ActionStatus) => {
    setOpening(true); setNotice(""); setSelected(null); setAction(null); setReason("");
    setEditingOrder(false); setEditCatalog(null); setEditLines([]); setEditReason("");
    setEditError(""); setAddingProduct(false); setProductSearch("");
    setContactError(""); setAssignError("");
    try {
      const detail = await request<OrderDetail>("/admin/orders/" + branchId + "/" + id, token);
      setSelected(detail);
      // Quick actions always read the authoritative latest status before opening
      // the existing confirmation sheet. A stale row cannot skip steps.
      if (quickAction && availableActions(detail.status, role).some(a => a.value === quickAction))
        setAction(quickAction);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được đơn hàng.");
    } finally { setOpening(false); }
  };
  useEffect(() => {
    if (!active || !token || !branchId || (role !== "OWNER" && role !== "MANAGER")) return;
    let mounted = true;
    void request<typeof drivers>("/admin/orders/" + branchId + "/drivers", token)
      .then(rows => { if (mounted) setDrivers(rows); })
      .catch(() => { if (mounted) setDrivers([]); });
    return () => { mounted = false; };
  }, [active, token, branchId, role]);

  const assignDriver = async (driverId: string) => {
    if (!selected || assignBusy) return;
    setAssignBusy(true); setAssignError("");
    try {
      await request("/admin/orders/" + branchId + "/" + selected.id + "/driver",
        token, "PUT", { driverId });
      const detail = await request<OrderDetail>(
        "/admin/orders/" + branchId + "/" + selected.id, token);
      setSelected(detail);
      setNotice("Đã phân công giao hàng cho nhân viên.");
      await sync();
    } catch (error) {
      setAssignError((error instanceof Error ? error.message : "Không phân công được.")
        + " Kiểm tra trạng thái đơn và quyền tài xế.");
    } finally { setAssignBusy(false); }
  };

  const openOrderContact = async (url: string) => {
    setContactError("");
    try {
      await Linking.openURL(url);
    } catch {
      setContactError("Không mở được ứng dụng gọi điện hoặc bản đồ trên thiết bị này.");
    }
  };

  const save = async () => {
    if (!selected || !action || saving) return;
    if ((action === "CANCELED" || action === "DELIVERY_FAILED") && reason.trim().length < 5) {
      setError(action === "DELIVERY_FAILED"
        ? "Cần nhập lý do giao thất bại ít nhất 5 ký tự."
        : "Cần nhập lý do hủy/từ chối ít nhất 5 ký tự."); return;
    }
    setSaving(true); setError("");
    try {
      await request("/admin/orders/" + branchId + "/" + selected.id + "/status",
        token, "PATCH", { expectedStatus: selected.status, toStatus: action,
          ...(["CANCELED", "DELIVERY_FAILED"].includes(action)
            ? { reason: reason.trim() } : {}) });
      setSelected(null); setAction(null); setReason("");
      setNotice("Đã cập nhật trạng thái đơn và ghi lịch sử.");
      await sync();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Không cập nhật được đơn.";
      setError(message + " Hãy tải lại đơn để kiểm tra trạng thái hiện tại.");
      setAction(null); setSelected(null); await sync();
    } finally { setSaving(false); }
  };

  const manager = role === "OWNER" || role === "MANAGER";
  const catalogProducts = useMemo(() =>
    editCatalog?.categories.flatMap(category => category.products) ?? [], [editCatalog]);
  const addableProducts = useMemo(() => {
    const query = productSearch.trim().toLocaleLowerCase("vi");
    return catalogProducts.filter(product => product.isAvailable
      && (!query || product.name.toLocaleLowerCase("vi").includes(query))).slice(0, 20);
  }, [catalogProducts, productSearch]);

  const productFor = (line: EditLine): CatalogProduct | undefined =>
    catalogProducts.find(product => product.id === line.productId);

  function groupsFor(product: CatalogProduct): CatalogGroup[] {
    return product.modifierGroups.filter(group => group.isAvailable !== false);
  }

  const beginEdit = async () => {
    if (!selected || !manager || !["PENDING", "CONFIRMED"].includes(selected.status)) return;
    setEditBusy(true); setEditError("");
    try {
      const catalog = await request<AdminCatalog>(
        "/admin/branches/" + branchId + "/catalog", token);
      const products = catalog.categories.flatMap(category => category.products);
      const draft: EditLine[] = selected.items.map((item, index) => {
        if (!item.productId) throw Error(
          "Đơn cũ thiếu mã món để sửa an toàn. Hãy hủy đơn và tạo lại thay vì đoán giá.");
        const product = products.find(candidate => candidate.id === item.productId);
        if (!product) throw Error("Một món trong đơn không còn thuộc chi nhánh này.");
        let variantId = item.variantId ?? null;
        if (!variantId && item.variantName) {
          const match = product.variants.filter(v => v.name === item.variantName);
          if (match.length !== 1) throw Error(
            "Không xác định được khẩu phần cũ. Không thể tự đoán khi sửa đơn.");
          variantId = match[0]!.id;
        }
        const modifierIds: string[] = [];
        for (const modifier of item.modifiers) {
          if (modifier.optionId) { modifierIds.push(modifier.optionId); continue; }
          const matches = groupsFor(product).flatMap(group => group.options)
            .filter(option => option.name === modifier.name
              && (modifier.priceVnd === undefined || option.priceDeltaVnd === modifier.priceVnd));
          if (matches.length !== 1) throw Error(
            "Đơn cũ có topping không xác định được ID. Không thể tự đoán khi sửa đơn.");
          modifierIds.push(matches[0]!.id);
        }
        const comboOptionIds: string[] = [];
        if (product.kind === "COMBO") {
          const historicalFixed = item.comboItems.filter(component => component.kind === "FIXED");
          if (historicalFixed.length !== product.comboFixedItems.length) {
            throw Error("Thành phần cố định của combo cũ đã thay đổi. Không thể tự đoán khi sửa đơn.");
          }
          const unmatchedFixed = [...historicalFixed];
          for (const fixed of product.comboFixedItems) {
            const matchIndex = unmatchedFixed.findIndex(snapshot => {
              const productMatches = snapshot.productId
                ? snapshot.productId === fixed.childProduct.id
                : snapshot.productName === fixed.childProduct.name;
              const variantMatches = snapshot.variantId
                ? snapshot.variantId === fixed.variant?.id
                : snapshot.variantName
                  ? snapshot.variantName === fixed.variant?.name
                  : fixed.variant == null;
              return productMatches && variantMatches && snapshot.quantity === fixed.quantity;
            });
            if (matchIndex < 0) {
              throw Error("Món hoặc size cố định của combo cũ đã thay đổi. Không thể tự đoán khi sửa đơn.");
            }
            unmatchedFixed.splice(matchIndex, 1);
          }
          for (const snapshot of item.comboItems.filter(component => component.kind === "CHOICE")) {
            const group = product.comboGroups.find(candidate => candidate.name === snapshot.groupName);
            if (!group) throw Error(
              "Nhóm lựa chọn của combo cũ đã thay đổi. Không thể tự đoán khi sửa đơn.");
            const matches = comboChoices(group).filter(option => {
              if (snapshot.modifierOptionId) {
                return option.sourceType === "TOPPING"
                  && option.sourceId === snapshot.modifierOptionId
                  && option.name === snapshot.productName;
              }
              if (option.sourceType !== "PRODUCT") return false;
              const productMatches = snapshot.productId
                ? option.sourceId === snapshot.productId
                : option.name === snapshot.productName;
              const variantMatches = snapshot.variantId
                ? option.variantId === snapshot.variantId
                : snapshot.variantName
                  ? option.variantName === snapshot.variantName
                  : option.variantId === null;
              return productMatches && variantMatches;
            });
            if (matches.length !== 1) throw Error(
              "Món/topping lựa chọn trong combo cũ đã thay đổi. Không thể tự đoán khi sửa đơn.");
            const option = matches[0]!;
            if (option.quantity < 1 || snapshot.quantity % option.quantity !== 0) {
              throw Error("Số lượng thành phần combo cũ không còn khớp cấu hình hiện tại.");
            }
            const count = snapshot.quantity / option.quantity;
            if (!Number.isSafeInteger(count) || count < 1 || count > 30) {
              throw Error("Số lượng lựa chọn combo cũ không hợp lệ.");
            }
            comboOptionIds.push(...Array(count).fill(option.id));
          }
        } else if (item.comboItems.length) {
          throw Error("Đơn cũ có thành phần combo nhưng sản phẩm hiện không còn là combo.");
        }
        return {
          key: item.id ?? "existing-" + index,
          productId: item.productId, variantId, modifierIds, comboOptionIds,
          quantity: item.quantity,
          ...(item.pricingMode === "SEPARATE" ? { pricingMode: "SEPARATE" as const } : {}),
        };
      });
      setEditCatalog(catalog); setEditLines(draft); setEditingOrder(true);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Không mở được chế độ sửa đơn.");
    } finally { setEditBusy(false); }
  };

  const addProduct = (product: CatalogProduct) => {
    setEditLines(lines => [...lines, {
      key: "new-" + Date.now() + "-" + product.id,
      productId: product.id, variantId: null, modifierIds: [], comboOptionIds: [],
      quantity: 1, pricingMode: "SEPARATE",
    }]);
    setAddingProduct(false); setProductSearch("");
  };

  const updateLine = (index: number, change: Partial<EditLine>) =>
    setEditLines(lines => lines.map((line, current) =>
      current === index ? { ...line, ...change } : line));

  const changeModifier = (lineIndex: number, group: CatalogGroup, optionId: string, delta: number) => {
    setEditLines(lines => lines.map((line, index) => {
      if (index !== lineIndex) return line;
      const ids = [...line.modifierIds];
      const optionIds = new Set(group.options.map(option => option.id));
      const groupCount = ids.filter(id => optionIds.has(id)).length;
      if (delta > 0) {
        if (groupCount >= group.maxSelect) return line;
        ids.push(optionId);
      } else {
        const at = ids.lastIndexOf(optionId);
        if (at >= 0) ids.splice(at, 1);
      }
      return { ...line, modifierIds: ids };
    }));
  };

  const changeComboOption = (
    lineIndex: number, group: CatalogComboGroup, optionId: string, delta: number,
  ) => {
    setEditLines(lines => lines.map((line, index) => {
      if (index !== lineIndex) return line;
      const optionIds = new Set(comboChoices(group).map(option => option.id));
      const groupCount = line.comboOptionIds.filter(id => optionIds.has(id)).length;
      const current = line.comboOptionIds.filter(id => id === optionId).length;
      const swapping = delta > 0 && current === 0 && groupCount === group.maxSelect;
      const nextCount = current + delta;
      const nextGroupCount = groupCount + delta - (swapping ? 1 : 0);
      if (nextCount < 0 || nextGroupCount < 0 || nextGroupCount > group.maxSelect
        || line.comboOptionIds.length + delta - (swapping ? 1 : 0) > 30) return line;
      const remaining = [...line.comboOptionIds];
      if (swapping) {
        const replaced = remaining.findIndex(id => optionIds.has(id));
        if (replaced >= 0) remaining.splice(replaced, 1);
      } else {
        for (let i = remaining.length - 1; i >= 0; i--) {
          if (remaining[i] === optionId) remaining.splice(i, 1);
        }
      }
      return {
        ...line,
        comboOptionIds: [...remaining, ...Array(nextCount).fill(optionId)],
      };
    }));
  };

  const saveEdit = async () => {
    if (!selected || editBusy) return;
    if (editReason.trim().length < 5) {
      setEditError("Nhập lý do sửa đơn ít nhất 5 ký tự để lưu lịch sử."); return;
    }
    if (editLines.length === 0) {
      setEditError("Đơn phải còn ít nhất một món. Nếu không phục vụ được, hãy hủy đơn."); return;
    }
    for (const line of editLines) {
      const product = productFor(line);
      if (!product) {
        setEditError("Có món không còn trong thực đơn. Hãy tải lại đơn."); return;
      }
      if (product.kind === "COMBO") {
        for (const group of product.comboGroups) {
          const ids = new Set(comboChoices(group).map(option => option.id));
          const count = line.comboOptionIds.filter(id => ids.has(id)).length;
          if (count < group.minSelect || count > group.maxSelect) {
            setEditError("Combo “" + product.name + "” · nhóm “" + group.name
              + "” cần chọn " + group.minSelect + "–" + group.maxSelect + " món/topping.");
            return;
          }
        }
      } else if (line.comboOptionIds.length) {
        setEditError("Món thường không thể chứa lựa chọn combo."); return;
      }
    }
    setEditBusy(true); setEditError("");
    try {
      await request("/admin/orders/" + branchId + "/" + selected.id + "/items",
        token, "PUT", {
          expectedStatus: selected.status, expectedUpdatedAt: selected.updatedAt,
          reason: editReason.trim(),
          items: editLines.map(line => ({
            productId: line.productId, variantId: line.variantId,
            modifierIds: line.modifierIds, comboOptionIds: line.comboOptionIds,
            quantity: line.quantity,
            ...(line.pricingMode === "SEPARATE" ? { pricingMode: "SEPARATE" } : {}),
          })),
        });
      setNotice("Đã sửa đơn, cập nhật tổng tiền và lưu lịch sử thay đổi.");
      setEditingOrder(false); setEditCatalog(null); setEditLines([]); setEditReason("");
      await sync();
      await openDetail(selected.id);
    } catch (e) {
      setEditError((e instanceof Error ? e.message : "Không sửa được đơn.")
        + " Kiểm tra món hết hàng, lựa chọn bắt buộc hoặc tải lại đơn.");
    } finally { setEditBusy(false); }
  };

  // Paging is performed server-side by lane. The list is only valid for the
  // exact server query that produced it (branch/status/history sub-filter).
  const visible = !badCode && !searchPending && loadedLaneUrl === laneUrl
    ? laneOrders : [];
  const pendingCount = orders.filter(x => x.status === "PENDING").length;
  const overdueCount = orders.filter(x => x.status === "PENDING"
    && clock - Date.parse(x.createdAt) >= 300000).length;
  const kitchenCount = orders.filter(x => x.status === "PREPARING").length;
  const deliveryCount = orders.filter(x => x.status === "DELIVERING").length;
  const deliveredCount = orders.filter(x => x.status === "DELIVERED").length;
  const canceledChange = selected?.status === "CANCELED"
    ? selected.statusHistory.find(change => change.toStatus === "CANCELED") : undefined;

  return <View style={s.page}>
    {mode !== "orders" && <>
      <View style={s.head}>
        <View style={s.headInfo}>
          <Text style={s.title}>{mode === "kitchen" ? "Phiếu bếp" : "Giao hàng"}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Đồng bộ đơn hàng"
          disabled={syncing || laneLoading} onPress={() => void sync()} style={s.refresh}>
          <Icon name="clock" color={syncing ? c.secondary : c.red} size={21} />
        </Pressable>
      </View>
      <View style={s.summary}>
        {(mode === "delivery" ? [
          ["Chờ giao", orders.filter(x => x.status === "READY").length],
          ["Đang giao", deliveryCount], ["Đã giao", deliveredCount],
        ] : [
          ["Đơn mới", pendingCount], ["Đang nấu", kitchenCount],
          ["Chờ giao", orders.filter(x => x.status === "READY").length],
        ]).map(([label, value], index) => <View key={String(label)}
          style={[s.summaryMetric, index === 0 && s.summaryMetricHot]}>
          <Text style={s.summaryNum}>{value}</Text>
          <Text style={s.note}>{label}</Text>
        </View>)}
      </View>
    </>}
    {!!error && <Notice error text={error} />}
    {!!laneError && <View style={s.retryRow}>
      <Notice error text={laneError} />
      <Pressable accessibilityRole="button" accessibilityLabel="Thử tải lại đơn hàng"
        onPress={() => void refreshLane()} style={s.retryButton}>
        <Text style={s.retryText}>Thử lại</Text>
      </Pressable>
    </View>}
    {!!notice && <Notice text={notice} />}
    {overdueCount > 0 && !kitchenOnly && <Notice error
      text={overdueCount + " đơn đang chờ xác nhận quá 5 phút. Cần xử lý ngay."} />}
    {mode === "orders" && group !== "history" && <View style={s.tabsToolbar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always" style={s.groupScroll}
        contentContainerStyle={s.groupRow} accessibilityLabel="Bộ lọc trạng thái đơn">
        {orderGroups.map(item => {
          const count = item.id === group && loadedLaneUrl === laneUrl && laneTotal !== null
            ? laneTotal : null;
          return <Pressable key={item.id} accessibilityRole="tab"
            accessibilityLabel={item.label} accessibilityState={{ selected: group === item.id }}
            style={[s.groupTab, group === item.id && s.groupTabActive]}
            onPress={() => onGroupChange(item.id)}>
            <Text style={[s.groupLabel, group === item.id && s.groupLabelActive]}>
              {item.label}{count !== null && <Text style={s.groupCount}> {count}</Text>}
            </Text>
          </Pressable>;
        })}
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Mở lịch sử đơn hàng"
        style={s.historyShortcut} onPress={() => onGroupChange("history")}>
        <Icon name="clock" color={c.red} size={22} />
      </Pressable>
    </View>}
    {mode === "orders" && group === "history" && <View style={s.historyHeading}>
      <Pressable accessibilityRole="button" accessibilityLabel="Quay lại đơn đang xử lý"
        style={s.historyBack} onPress={onCloseHistory}>
        <View style={s.backChevron}><Icon name="chevron" size={20} color={c.redDeep} /></View>
        <Text style={s.historyBackText}>Đơn hàng</Text>
      </Pressable>
      <Text style={s.historyHeadingTitle} numberOfLines={1}>Lịch sử đơn</Text>
      <Pressable accessibilityRole="button"
        accessibilityLabel="Đồng bộ lịch sử đơn hàng" accessibilityState={{ disabled: syncing || laneLoading }}
        disabled={syncing || laneLoading} onPress={() => void sync()} style={s.refresh}>
        <Icon name="clock" color={syncing ? c.secondary : c.red} size={20} />
      </Pressable>
    </View>}
    {inHistory && reportMetric && <View style={s.reportDrilldown}>
      <Text style={s.reportDrilldownText}>Đang xem đơn từ Báo cáo · {reportMetric}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Thoát bộ lọc báo cáo"
        onPress={onClearReportMetric} style={s.exitDrilldown}>
        <Text style={s.exitDrilldownText}>Đóng ×</Text>
      </Pressable>
    </View>}
    {inHistory && !reportMetric && <View style={s.historyLookup}>
      <TextInput accessibilityLabel="Tìm theo mã đơn" autoCapitalize="characters"
        autoCorrect={false} returnKeyType="search"
        style={s.codeInput} placeholder="Mã đơn · VD: 793C85B1"
        placeholderTextColor="#9197A0" value={historyCode}
        maxLength={37} onChangeText={onHistoryCodeChange} />
      {!!historyCode && <Pressable accessibilityRole="button" accessibilityLabel="Xóa mã đơn"
        onPress={() => onHistoryCodeChange("")} style={s.clearCode}>
        <Icon name="close" color={c.secondary} size={16} />
      </Pressable>}
    </View>}
    {inHistory && <HistoryDateFilter value={historyRange} onChange={onHistoryRangeChange} />}
    {inHistory && hasCode && <Text style={s.lookupHint}>
      Tra cứu mã đơn ở mọi trạng thái · Theo ngày tạo
    </Text>}
    {inHistory && badCode && <Text style={s.codeError}>
      Nhập 8 ký tự mã đơn hoặc UUID đầy đủ.
    </Text>}
    {inHistory && !historyCode.trim() && !reportMetric && <ScrollView horizontal
      showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always"
      accessibilityLabel="Lọc lịch sử đơn hàng" style={s.historyScroll}
      contentContainerStyle={s.historyFilters}>
      {historyFilters.map(item => <Pressable key={item.value} accessibilityRole="button"
        accessibilityLabel={"Lọc lịch sử " + item.label}
        accessibilityState={{ selected: historyStatus === item.value }}
        style={[s.historyFilter, historyStatus === item.value && s.historyFilterActive]}
        onPress={() => onHistoryStatusChange(item.value)}>
        <Text style={[s.historyFilterLabel,
          historyStatus === item.value && s.historyFilterLabelActive]}>
          {item.label}
        </Text>
      </Pressable>)}
    </ScrollView>}
    <ScrollView key={laneUrl} style={s.orderListScroll} contentContainerStyle={s.orderListContent}
      keyboardShouldPersistTaps="handled">
    {badCode ? null : (loading || searchPending || (loadedLaneUrl !== laneUrl && !laneError)
      || (laneLoading && visible.length === 0))
      ? <ActivityIndicator color={c.red} style={{ marginVertical: 30 }} /> :
      visible.length === 0 ? <View style={s.empty}>
        <View style={s.emptyIcon}>
          <Icon name={mode === "kitchen" ? "kitchen" :
            mode === "delivery" ? "delivery" : "orders"} color={c.red} size={29} />
        </View>
        <Text style={s.emptyHeading}>
          {mode === "kitchen" ? "Bếp chưa có phiếu cần xử lý"
            : mode === "delivery" ? "Chưa có đơn trong danh sách giao"
            : "Chưa có đơn hàng trong nhóm này"}
        </Text>
      </View> : <View style={s.rows}>
        {visible.map(order => <View key={order.id} style={s.orderCard}>
          <View style={s.orderHeader}>
            <Text style={s.orderId}>#{order.id.slice(0, 8).toUpperCase()}</Text>
            <View style={[s.statusPill, { backgroundColor: statusTone[order.status].background }]}>
              <Text style={[s.status, { color: statusTone[order.status].text }]}>
                {statusName[order.status]}
              </Text>
            </View>
            <View style={{ flex: 1 }} />
            <Icon name="clock" size={16} color={c.secondary} />
            <Text style={s.date}>{when(order.createdAt)}</Text>
          </View>
          <View style={s.cardContent}>
            <View style={s.cardDishIcon}>
              <Icon name="kitchen" size={25} color={c.redDeep} />
            </View>
            <View style={s.cardProducts}>
              {order.items.slice(0, 3).map((item, idx) =>
                <Text key={idx} numberOfLines={1} style={s.productLine}>
                  {item.quantity} × {item.productName}
                </Text>)}
              {order.items.length > 3 && <Text style={s.note}>
                + {order.items.length - 3} món khác
              </Text>}
            </View>
            {!kitchenOnly && order.totalVnd !== undefined && <View style={s.cardTotal}>
              <Text style={s.note}>Tổng tiền</Text>
              <Text style={s.total}>{money(order.totalVnd)}</Text>
              {!!order.payment?.method &&
                <Text style={s.paymentChip}>{order.payment.method}</Text>}
            </View>}
          </View>
          {availableActions(order.status, role).filter(a => a.value !== "CANCELED"
            && a.value !== "DELIVERY_FAILED").slice(0, 1).map(a =>
            <Pressable key={a.value} accessibilityRole="button"
              accessibilityLabel={a.label + " đơn " + order.id.slice(0, 8)}
              style={s.quickButton} onPress={() => void openDetail(order.id, a.value)}>
              <Text style={s.quickButtonText}>{a.label} →</Text>
            </Pressable>)}
          <Pressable accessibilityRole="button"
            accessibilityLabel={"Xem đơn " + order.id.slice(0, 8)}
            style={({ pressed }) => [s.detailButton, pressed && s.pressed]}
            onPress={() => void openDetail(order.id)}>
            <Icon name="orders" size={19} color={c.redDeep} />
            <Text style={s.detailButtonLabel}>
              {mode === "kitchen" ? "Xem phiếu & xử lý bếp"
                : mode === "delivery" ? "Xem trạng thái giao hàng" : "Xem chi tiết & xử lý"}
            </Text>
            <Text style={s.detailButtonArrow}>›</Text>
          </Pressable>
        </View>)}
      </View>}
      {!!laneCursor && !badCode && !searchPending && loadedLaneUrl === laneUrl && <Pressable accessibilityRole="button"
        accessibilityLabel="Xem thêm đơn hàng cũ trong nhóm"
        disabled={laneLoading || laneLoadingMore} accessibilityState={{ disabled: laneLoading || laneLoadingMore }}
        style={s.moreButton} onPress={() => void loadMoreLane()}>
        <Text style={s.moreText}>{laneLoadingMore ? "Đang tải lịch sử..." : "Xem thêm đơn cũ"}</Text>
      </Pressable>}
    </ScrollView>
    {opening && <ActivityIndicator color={c.red} />}
    <Modal visible={!!selected} transparent animationType="slide"
      onRequestClose={() => { if (!saving) { setSelected(null); setAction(null); } }}>
      <SafeAreaView edges={["bottom"]} style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.sheetHead}>
            <Text style={s.title}>Đơn #{selected?.id.slice(0, 8).toUpperCase()}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Đóng chi tiết đơn"
              disabled={saving || editBusy} onPress={() => {
                setSelected(null); setAction(null); setEditingOrder(false);
              }} style={s.close}>
              <Icon name="close" size={19} color={c.ink} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={s.sheetContent} keyboardShouldPersistTaps="handled">
            {selected && <>
              <View style={s.detailStatusRow}>
                <View style={[s.statusPill, { backgroundColor: statusTone[selected.status].background }]}>
                  <Text style={[s.status, { color: statusTone[selected.status].text }]}>
                    {statusName[selected.status]}
                  </Text>
                </View>
                <Text style={s.note}>Đặt lúc {when(selected.createdAt)}</Text>
              </View>
              {selected.status === "CANCELED" && <View style={s.cancelInfo}>
                <Text style={s.cancelTitle}>Đơn đã hủy</Text>
                <Text style={s.cancelText}>{canceledChange
                  ? "Hủy lúc " + new Date(canceledChange.createdAt).toLocaleString("vi-VN")
                    + " · " + cancellationSourceLabel[canceledChange.source]
                  : "Chưa có lịch sử xác định thời điểm và bên hủy."}</Text>
                {canceledChange?.reason && <Text style={s.cancelText}>
                  Lý do: {canceledChange.reason}
                </Text>}
              </View>}
              <View style={s.timeline}>
                {(["PENDING", "CONFIRMED", "PREPARING", "READY"] as const).map((status, index) => {
                  const history = selected.statusHistory.find(row => row.toStatus === status);
                  const reachedAt = status === "PENDING" ? selected.createdAt : history?.createdAt;
                  return <View style={s.timelineStep} key={status}>
                    <View style={[s.timelineDot, reachedAt && s.timelineDone]}>
                      {reachedAt && <Icon name="check" size={14} color={c.white} />}
                    </View>
                    <Text style={[s.timelineLabel, reachedAt && s.timelineLabelDone]} numberOfLines={2}>
                      {["Mới đặt", "Đã nhận", "Đang nấu", "Sẵn sàng"][index]}
                    </Text>
                    <Text style={s.timelineClock}>
                      {reachedAt ? new Date(reachedAt).toLocaleTimeString("vi-VN",{
                        hour:"2-digit", minute:"2-digit",
                      }) : "--:--"}
                    </Text>
                  </View>;
                })}
              </View>
              {!!selected.customerNote && <View style={s.customerNoteBox}>
                <Text style={s.customerNoteTitle}>Ghi chú khách hàng</Text>
                <Text style={s.customerNoteText}>{selected.customerNote}</Text>
              </View>}
              <View style={s.detailSectionRow}>
                <Text style={s.detailSectionTitle}>Danh sách món ({selected.items.length} dòng món)</Text>
                {manager && ["PENDING", "CONFIRMED"].includes(selected.status) && !editingOrder &&
                  <Pressable accessibilityRole="button" accessibilityLabel="Sửa món trong đơn"
                    disabled={editBusy} onPress={() => void beginEdit()} style={s.inlineEdit}>
                    <Text style={s.inlineEditText}>{editBusy ? "Đang mở…" : "Sửa đơn"}</Text>
                  </Pressable>}
              </View>
              {!!editError && <Notice error text={editError} />}
              {editingOrder && editCatalog ? <View style={s.editPanel}>
                <Text style={s.editHint}>
                  Chỉ chủ quán hoặc quản lý được sửa đơn trước khi bếp bắt đầu nấu. Tổng tiền sẽ được cập nhật theo thực đơn hiện tại.
                </Text>
                {editLines.map((line, lineIndex) => {
                  const product = productFor(line);
                  if (!product) return <Notice key={line.key} error text="Món không còn trong catalog." />;
                  return <View key={line.key} style={s.editLine}>
                    <View style={s.rowTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.itemName}>{product.name}</Text>
                        {!product.isAvailable && <Text style={s.editWarning}>Món đang hết hàng — hãy xóa hoặc thay.</Text>}
                      </View>
                      <Pressable accessibilityRole="button" accessibilityLabel={"Xóa " + product.name}
                        style={s.removeLine} onPress={() =>
                          setEditLines(lines => lines.filter((_, index) => index !== lineIndex))}>
                        <Text style={s.removeLineText}>Xóa</Text>
                      </Pressable>
                    </View>
                    <View style={s.quantityRow}>
                      <Text style={s.note}>Số lượng</Text>
                      <Pressable accessibilityRole="button" accessibilityLabel="Giảm số lượng"
                        style={s.qtyButton} onPress={() =>
                          updateLine(lineIndex, { quantity: Math.max(1, line.quantity - 1) })}>
                        <Text style={s.qtyText}>−</Text>
                      </Pressable>
                      <Text style={s.qtyValue}>{line.quantity}</Text>
                      <Pressable accessibilityRole="button" accessibilityLabel="Tăng số lượng"
                        style={s.qtyButton} onPress={() =>
                          updateLine(lineIndex, { quantity: Math.min(99, line.quantity + 1) })}>
                        <Text style={s.qtyText}>＋</Text>
                      </Pressable>
                    </View>
                    {product.kind === "COMBO" && <View style={s.editChoices}>
                      <Text style={s.itemName}>Thành phần combo</Text>
                      {product.comboFixedItems.map(component =>
                        <Text key={component.id} style={s.note}>
                          • {component.quantity} × {component.childProduct.name}
                          {component.childProduct.isAvailable ? "" : " · đang hết"}
                        </Text>)}
                      {product.comboGroups.map(group => {
                        const allowed = new Set(group.options.map(option => option.id));
                        const selectedCount = line.comboOptionIds.filter(id => allowed.has(id)).length;
                        return <View key={group.id} style={s.editChoices}>
                          <Text style={s.note}>{group.name} · chọn {group.minSelect}–{group.maxSelect}
                            {" · hiện "}{selectedCount}</Text>
                          {comboChoices(group).map(option => {
                            const count = line.comboOptionIds.filter(id => id === option.id).length;
                            const atMax = selectedCount >= group.maxSelect;
                            const wouldSwap = selectedCount === group.maxSelect && count === 0;
                            return <View key={option.id} style={s.modifierRow}>
                              <View style={{ flex: 1 }}>
                                <Text style={s.modifierName}>
                                  {option.quantity} × {option.name}
                                  {option.variantName ? " · " + option.variantName : ""}
                                  {option.sourceType === "TOPPING" && option.sourceGroupName
                                    ? " · topping/" + option.sourceGroupName : ""}
                                  {option.priceDeltaVnd ? " · +" + money(option.priceDeltaVnd) : ""}
                                </Text>
                                {!option.isAvailable &&
                                  <Text style={s.editWarning}>
                                    {option.sourceType === "TOPPING" ? "Topping đang tạm hết" : "Món hoặc size đang tạm hết"}
                                  </Text>}
                              </View>
                              <Pressable accessibilityRole="button"
                                accessibilityLabel={"Giảm " + option.name}
                                disabled={count === 0 || selectedCount <= group.minSelect}
                                style={[s.qtyButton,
                                  (count === 0 || selectedCount <= group.minSelect) && s.disabledButton]}
                                onPress={() => changeComboOption(lineIndex, group, option.id, -1)}>
                                <Text style={s.qtyText}>−</Text>
                              </Pressable>
                              <Text style={s.qtyValue}>{count}</Text>
                              <Pressable accessibilityRole="button"
                                accessibilityLabel={"Thêm " + option.name}
                                disabled={!option.isAvailable || (!wouldSwap && atMax)}
                                style={[s.qtyButton,
                                  (!option.isAvailable || (!wouldSwap && atMax)) && s.disabledButton]}
                                onPress={() => changeComboOption(lineIndex, group, option.id, 1)}>
                                <Text style={s.qtyText}>＋</Text>
                              </Pressable>
                            </View>;
                          })}
                          {selectedCount < group.minSelect &&
                            <Text style={s.editWarning}>Cần chọn thêm {group.minSelect - selectedCount} món/topping.</Text>}
                        </View>;
                      })}
                    </View>}
                    {product.variants.length > 0 && <View style={s.editChoices}>
                      <Text style={s.note}>Khẩu phần</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <Pill label="Mặc định" active={line.variantId === null}
                          onPress={() => updateLine(lineIndex, { variantId: null })} />
                        {product.variants.filter(v => v.isAvailable).map(variant =>
                          <Pill key={variant.id} label={variant.name}
                            active={line.variantId === variant.id}
                            onPress={() => updateLine(lineIndex, { variantId: variant.id })} />)}
                      </ScrollView>
                    </View>}
                    {groupsFor(product).map(group => {
                      const allowed = new Set(group.options.map(option => option.id));
                      const selectedCount = line.modifierIds.filter(id => allowed.has(id)).length;
                      return <View key={group.id} style={s.editChoices}>
                        <Text style={s.note}>{group.name} · chọn {group.minSelect}–{group.maxSelect}
                          {" · hiện "}{selectedCount}</Text>
                        {group.options.filter(option => option.isAvailable).map(option => {
                          const count = line.modifierIds.filter(id => id === option.id).length;
                          return <View key={option.id} style={s.modifierRow}>
                            <Text style={s.modifierName}>{option.name}
                              {option.priceDeltaVnd ? " · +" + money(option.priceDeltaVnd) : ""}
                            </Text>
                            <Pressable accessibilityRole="button"
                              accessibilityLabel={"Giảm " + option.name} disabled={count === 0}
                              style={[s.qtyButton, count === 0 && s.disabledButton]}
                              onPress={() => changeModifier(lineIndex, group, option.id, -1)}>
                              <Text style={s.qtyText}>−</Text>
                            </Pressable>
                            <Text style={s.qtyValue}>{count}</Text>
                            <Pressable accessibilityRole="button"
                              accessibilityLabel={"Thêm " + option.name}
                              disabled={selectedCount >= group.maxSelect}
                              style={[s.qtyButton, selectedCount >= group.maxSelect && s.disabledButton]}
                              onPress={() => changeModifier(lineIndex, group, option.id, 1)}>
                              <Text style={s.qtyText}>＋</Text>
                            </Pressable>
                          </View>;
                        })}
                      </View>;
                    })}
                  </View>;
                })}
                {addingProduct ? <View style={s.addProductPanel}>
                  <Field label="Tìm món để thêm" value={productSearch}
                    onChangeText={setProductSearch} placeholder="Tên món" />
                  {addableProducts.map(product =>
                    <Pressable key={product.id} accessibilityRole="button"
                      style={s.productPick} onPress={() => addProduct(product)}>
                      {imageUrl(product.imageKey) ?
                        <Image source={{ uri: imageUrl(product.imageKey)! }}
                          style={s.editProductPhoto} accessibilityLabel={"Ảnh " + product.name} /> :
                        <View style={s.editProductFallback}><Text style={s.note}>Ảnh</Text></View>}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.itemName}>{product.name}</Text>
                        {product.kind === "COMBO" && <Text style={s.note}>Combo</Text>}
                      </View>
                      <Text style={s.products}>{money(product.priceVnd)}</Text>
                    </Pressable>)}
                  {addableProducts.length === 0 && <Text style={s.note}>Không tìm thấy món đang bán.</Text>}
                  <Action secondary label="Đóng danh sách" onPress={() => setAddingProduct(false)} />
                </View> :
                  <Action secondary label="＋ Thêm món" onPress={() => setAddingProduct(true)} />}
                <Field label="Lý do sửa đơn" value={editReason} onChangeText={setEditReason}
                  placeholder="Ví dụ: món hết, khách đồng ý đổi món" multiline />
                <Action label={editBusy ? "Đang lưu…" : "Lưu đơn đã sửa"}
                  disabled={editBusy || editLines.length === 0 || editReason.trim().length < 5}
                  onPress={() => void saveEdit()} />
                <Action secondary label="Hủy chỉnh sửa" disabled={editBusy}
                  onPress={() => { setEditingOrder(false); setEditCatalog(null); setEditLines([]);
                    setEditReason(""); setEditError(""); }} />
              </View> : <>
                {selected.items.map((item, i) => <View key={item.id ?? i} style={s.item}>
                  <View style={s.itemOrdinal}><Text style={s.itemOrdinalLabel}>{i + 1}</Text></View>
                  <View style={s.rowTop}>
                    <Text style={s.itemName}>{item.quantity} × {item.productName}</Text>
                    {!kitchenOnly && item.lineTotalVnd !== undefined &&
                      <Text style={s.products}>{money(item.lineTotalVnd)}</Text>}
                  </View>
                  {!!item.variantName && <Text style={s.note}>{item.variantName}</Text>}
                  {item.comboItems.map((component, j) =>
                    <Text key={"combo-" + j} style={s.note}>
                      {component.kind === "CHOICE" && component.groupName
                        ? "• " + component.groupName + ": " : "• "}
                      {component.quantity} × {component.productName}
                      {component.variantName ? " · " + component.variantName : ""}
                      {!kitchenOnly && component.priceDeltaVnd
                        ? " (+" + money(component.priceDeltaVnd) + ")" : ""}
                    </Text>)}
                  {item.modifiers.map((m,j) =>
                    <Text key={j} style={s.note}>+ {m.name}
                      {!kitchenOnly && m.priceVnd !== undefined ? " (" + money(m.priceVnd) + ")" : ""}
                    </Text>)}
                </View>)}
              </>}
              {!kitchenOnly && selected.subtotalVnd !== undefined &&
                selected.deliveryFeeVnd !== undefined && selected.totalVnd !== undefined &&
                <View style={s.totals}>
                  <Text style={s.note}>Tiền món: {money(selected.subtotalVnd)}</Text>
                  <Text style={s.note}>Phí giao: {money(selected.deliveryFeeVnd)}</Text>
                  <Text style={s.total}>Tổng thu: {money(selected.totalVnd)}</Text>
                  <Text style={s.note}>Thanh toán: {selected.payment?.method ?? "Chưa xác định"}
                    {" · "}{selected.payment?.status ?? "Chưa xác định"}</Text>
                </View>}
              {!kitchenOnly && <>
                <View style={s.deliveryContact}>
                  <Text style={s.itemName}>Thông tin giao hàng</Text>
                  {!!selected.addressLineSnapshot && <Text style={s.products}>
                    {selected.addressLineSnapshot}{displayAdministrativeSelection({
                      catalogVersion: selected.catalogVersionSnapshot,
                      provinceCode: selected.provinceCodeSnapshot,
                      wardCode: selected.wardCodeSnapshot,
                    }) ? ", " + displayAdministrativeSelection({
                      catalogVersion: selected.catalogVersionSnapshot,
                      provinceCode: selected.provinceCodeSnapshot,
                      wardCode: selected.wardCodeSnapshot,
                    }) : ""}
                  </Text>}
                  {!!selected.phoneSnapshot && <Text style={s.note}>
                    SĐT khách: {selected.phoneSnapshot}
                  </Text>}
                  <View style={s.deliveryContactActions}>
                    {orderCustomerCallUrl(selected.phoneSnapshot) && <Pressable
                      accessibilityRole="button" accessibilityLabel="Gọi điện cho khách hàng"
                      style={({ pressed }) => [s.deliveryContactAction, pressed && s.pressed]}
                      onPress={() => {
                        const url = orderCustomerCallUrl(selected.phoneSnapshot);
                        if (url) void openOrderContact(url);
                      }}>
                      <Icon name="phone" size={20} color={c.white} />
                      <Text style={s.deliveryContactActionText}>Gọi khách</Text>
                    </Pressable>}
                    {orderCustomerDirectionsUrl(selected.latitudeSnapshot, selected.longitudeSnapshot)
                      && <Pressable accessibilityRole="button"
                        accessibilityLabel="Xem định vị khách hàng và chỉ đường trên bản đồ"
                        style={({ pressed }) => [s.deliveryContactAction, s.deliveryMapAction,
                          pressed && s.pressed]}
                        onPress={() => {
                          const url = orderCustomerDirectionsUrl(
                            selected.latitudeSnapshot, selected.longitudeSnapshot);
                          if (url) void openOrderContact(url);
                        }}>
                        <Icon name="pin" size={20} color={c.redDeep} />
                        <Text style={s.deliveryMapActionText}>Xem vị trí / Chỉ đường</Text>
                      </Pressable>}
                  </View>
                  {!orderCustomerCallUrl(selected.phoneSnapshot) && <Text style={s.note}>
                    Đơn này chưa có số điện thoại hợp lệ để gọi.
                  </Text>}
                  {!orderCustomerDirectionsUrl(selected.latitudeSnapshot, selected.longitudeSnapshot)
                    && <Text style={s.note}>
                      Đơn này chưa có ghim GPS hợp lệ. Kiểm tra địa chỉ trước khi giao.
                    </Text>}
                  {!!contactError && <Notice error text={contactError} />}
                </View>
                {manager && ["READY", "DELIVERY_FAILED"].includes(selected.status) && (
                  <View style={s.driverAssign}>
                    <Text style={s.itemName}>Phân công nhân viên giao</Text>
                    <Text style={s.note}>
                      {selected.deliveryAssignment?.driverId
                        ? "Đã phân công · có thể chọn lại trước khi giao."
                        : "Chưa phân công. Chủ/quản lý vẫn có thể tự giao."}
                    </Text>
                    {drivers.map(driver => <Pressable key={driver.userId}
                      accessibilityRole="button"
                      accessibilityLabel={"Giao cho tài xế " + (driver.user.phoneE164 ?? driver.userId.slice(0, 8))}
                      disabled={assignBusy}
                      onPress={() => void assignDriver(driver.userId)}
                      style={[s.driverOption,
                        selected.deliveryAssignment?.driverId === driver.userId && s.driverOptionActive]}>
                      <Icon name="delivery" size={19} color={c.redDeep} />
                      <Text style={s.driverOptionText}>
                        {driver.user.phoneE164 ?? ("Tài xế #" + driver.userId.slice(0, 8))}
                        {selected.deliveryAssignment?.driverId === driver.userId ? " ✓" : ""}
                      </Text>
                    </Pressable>)}
                    {drivers.length === 0 && <Text style={s.note}>
                      Chưa có nhân viên DRIVER trong chi nhánh này.
                    </Text>}
                    {!!assignError && <Notice text={assignError} error />}
                  </View>
                )}
              </>}
              {!!selected.edits?.length && <>
                <Text style={s.detailSectionTitle}>Lịch sử sửa đơn</Text>
                {selected.edits.map((edit, i) =>
                  <Text key={i} style={s.note}>
                    {when(edit.createdAt)} · {edit.reason} · {money(edit.beforeTotalVnd)} → {money(edit.afterTotalVnd)}
                  </Text>)}
              </>}
              <Text style={s.detailSectionTitle}>Lịch sử trạng thái</Text>
              {selected.statusHistory.map((h,i) =>
                <Text key={i} style={s.note}>
                  {when(h.createdAt)} · {statusName[h.toStatus]}
                  {h.toStatus === "CANCELED" ? " · " + cancellationSourceLabel[h.source] : ""}
                  {h.reason ? " · " + h.reason : ""}
                </Text>)}
              {availableActions(selected.status, role).length > 0 && <View style={s.actions}>
                {!action ? availableActions(selected.status, role).map(a =>
                  <Action key={a.value} label={a.label}
                    secondary={a.value === "CANCELED"} onPress={() => setAction(a.value)} />) : <>
                  <Text style={s.itemName}>Xác nhận: {statusName[action]}?</Text>
                  {["CANCELED", "DELIVERY_FAILED"].includes(action) && <Field
                    label={action === "DELIVERY_FAILED" ? "Lý do giao thất bại" : "Lý do bắt buộc"}
                    value={reason} onChangeText={setReason}
                    placeholder={action === "DELIVERY_FAILED"
                      ? "Ví dụ: khách không nghe máy" : "Nêu rõ lý do cho khách"} multiline />}
                  {action === "DELIVERED" && selected.payment?.method === "COD"
                    && selected.payment.status === "PENDING" &&
                    <Text style={s.editHint}>Xác nhận đã giao sẽ đồng thời ghi nhận COD đã thu.</Text>}
                  <Action label={saving ? "Đang cập nhật..." : "Xác nhận cập nhật"}
                    disabled={saving || (["CANCELED", "DELIVERY_FAILED"].includes(action)
                      && reason.trim().length < 5)}
                    onPress={() => void save()} />
                  <Action label="Quay lại" secondary disabled={saving}
                    onPress={() => setAction(null)} />
                </>}
              </View>}
            </>}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  </View>;
}

const s = StyleSheet.create({
  page: { flex: 1, minHeight: 0, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 16, gap: 9 },
  head: { flexDirection: "row", gap: 10, alignItems: "center" },
  headInfo: { flex: 1, gap: 3 },
  title: { fontSize: font.title, fontWeight: "800", color: c.ink },
  note: { fontSize: font.note, color: c.secondary, lineHeight: 18 },
  refresh: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  summary: { flexDirection: "row", borderBottomWidth: 1, borderColor: c.line,
    paddingBottom: 6, gap: 5 },
  summaryMetric: { flex: 1, gap: 3, paddingHorizontal: 6, paddingVertical: 5,
    alignItems: "center", borderRadius: 9 },
  summaryNum: { fontSize: 18, fontWeight: "800", color: c.ink },
  sync: { fontSize: font.caption, color: c.green },
  syncError: { color: c.red },
  filter: { flexDirection: "row", gap: 8 },
  tabsToolbar: { flexDirection: "row", alignItems: "center",
    borderBottomWidth: 1, borderColor: c.line },
  groupScroll: { flex: 1, minWidth: 0 },
  groupRow: { gap: 6, paddingVertical: 6, paddingHorizontal: 2 },
  groupTab: { minHeight: 44, paddingHorizontal: 12, alignItems: "center",
    justifyContent: "center", borderBottomWidth: 3, borderColor: "transparent" },
  groupTabActive: { borderBottomColor: c.red },
  groupLabel: { fontSize: font.note, color: c.secondary, fontWeight: "700" },
  groupLabelActive: { color: c.redDeep, fontWeight: "900" },
  groupCount: { fontSize: 11, fontWeight: "600" },
  historyShortcut: { width: 48, minHeight: 48, alignItems: "center",
    justifyContent: "center", borderLeftWidth: 1, borderLeftColor: c.line },
  historyHeading: { flexDirection: "row", alignItems: "center", minHeight: 49,
    paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: c.line, gap: 4 },
  historyBack: { minHeight: 44, flexDirection: "row", alignItems: "center",
    gap: 1, paddingRight: 6 },
  backChevron: { transform: [{ rotate: "180deg" }] },
  historyBackText: { color: c.redDeep, fontSize: font.note, fontWeight: "700" },
  historyHeadingTitle: { flex: 1, color: c.ink, fontSize: font.note,
    fontWeight: "800", textAlign: "center" },
  reportDrilldown: { minHeight: 44, flexDirection: "row", alignItems: "center",
    gap: 8, borderBottomWidth: 1, borderBottomColor: c.line },
  reportDrilldownText: { flex: 1, color: c.ink, fontSize: 12, fontWeight: "700" },
  exitDrilldown: { minHeight: 44, justifyContent: "center", paddingHorizontal: 6 },
  exitDrilldownText: { color: c.redDeep, fontSize: 12, fontWeight: "800" },
  historyLookup: { flexDirection: "row", alignItems: "center", minHeight: 44,
    borderWidth: 1, borderColor: c.line, borderRadius: 10, backgroundColor: c.white },
  codeInput: { flex: 1, minWidth: 0, color: c.ink, paddingHorizontal: 12,
    paddingVertical: 8, fontSize: 15, minHeight: 44 },
  clearCode: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  lookupHint: { color: c.secondary, fontSize: 11, paddingHorizontal: 2 },
  codeError: { color: c.redDeep, fontSize: 12, paddingHorizontal: 2 },
  retryRow: { gap: 6 },
  retryButton: { alignSelf: "flex-start", paddingHorizontal: 16, minHeight: 42,
    borderRadius: 9, justifyContent: "center", backgroundColor: c.soft },
  retryText: { color: c.redDeep, fontWeight: "800" },
  historyScroll: { flexGrow: 0, maxHeight: 48 },
  historyFilters: { gap: 6, alignItems: "center", paddingVertical: 2, paddingHorizontal: 2 },
  historyFilter: { borderRadius: 9, backgroundColor: "#F6F1EC", paddingHorizontal: 11,
    minHeight: 40, justifyContent: "center" },
  historyFilterActive: { backgroundColor: "#FDE4E8" },
  historyFilterLabel: { color: c.secondary, fontWeight: "700", fontSize: 12 },
  historyFilterLabelActive: { color: c.redDeep },
  orderListScroll: { flex: 1 },
  orderListContent: { paddingBottom: 20, flexGrow: 1 },
  moreButton: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 18,
    alignItems: "center", justifyContent: "center", marginVertical: 10,
    borderRadius: 9, borderWidth: 1, borderColor: c.red },
  moreText: { color: c.redDeep, fontWeight: "800", fontSize: font.note },
  quickButton: { minHeight: 44, backgroundColor: "#DDF4E5", borderRadius: 8,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  quickButtonText: { color: "#175A30", fontSize: font.note, fontWeight: "800" },
  driverAssign: { paddingVertical: 12, gap: 7 },
  driverOption: { minHeight: 44, flexDirection: "row", alignItems: "center",
    paddingHorizontal: 10, gap: 9, borderWidth: 1, borderColor: c.line, borderRadius: 9 },
  driverOptionActive: { borderColor: c.red, backgroundColor: "#FFF0F0" },
  driverOptionText: { color: c.ink, fontSize: font.note, fontWeight: "700" },
  rows: { gap: 4 },
  row: { paddingVertical: 13, paddingHorizontal: 4, gap: 7,
    borderBottomWidth: 1, borderColor: c.line, minHeight: 100 },
  pressed: { opacity: 0.6 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  orderId: { fontWeight: "900", color: c.ink, fontSize: 16 },
  date: { color: c.secondary, fontSize: font.caption },
  status: { color: c.green, fontWeight: "700", fontSize: font.note },
  urgent: { color: c.red },
  total: { fontWeight: "900", color: c.red, fontSize: 15 },
  products: { color: c.secondary, fontSize: font.note, lineHeight: 19, flexShrink: 1 },
  deliveryContact: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.line,
    paddingVertical: 12, gap: 8 },
  deliveryContactActions: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  deliveryContactAction: { minHeight: 46, borderRadius: 10, backgroundColor: c.red,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
    paddingHorizontal: 14, flexGrow: 1, flexBasis: 130 },
  deliveryMapAction: { backgroundColor: "#FFF1F1", borderWidth: 1,
    borderColor: "#F5D7D9" },
  deliveryContactActionText: { color: c.white, fontSize: font.note, fontWeight: "800" },
  deliveryMapActionText: { color: c.redDeep, fontSize: font.note, fontWeight: "800" },
  empty: { minHeight: 136, justifyContent: "center", alignItems: "center",
    gap: 7, padding: 14 },
  overlay: { flex: 1, backgroundColor: "rgba(12,18,28,0.48)",
    justifyContent: "flex-end" },
  sheet: { maxHeight: "92%", backgroundColor: c.white,
    borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: "hidden" },
  sheetHead: { minHeight: 56, flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", paddingHorizontal: 16, borderBottomWidth: 1, borderColor: c.line },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  sheetContent: { padding: 12, paddingBottom: 20, gap: 9 },
  item: { gap: 3, borderBottomWidth: 1, borderColor: c.line, paddingBottom: 9 },
  editProductPhoto: { width: 48, height: 48, borderRadius: 9, backgroundColor: c.pale },
  editProductFallback: { width: 48, height: 48, borderRadius: 9,
    backgroundColor: c.pale, alignItems: "center", justifyContent: "center" },
  itemName: { fontSize: font.body, fontWeight: "700", color: c.ink, flexShrink: 1 },
  totals: { gap: 4, paddingVertical: 10, borderBottomWidth: 1, borderColor: c.line },
  actions: { paddingTop: 10, gap: 10 },
  summaryMetricHot: { backgroundColor: "#FFE9EB", borderRadius: 12 },
  orderCard: { backgroundColor: c.white, borderRadius: 12, borderColor: "#EFE3D9",
    borderWidth: 1, padding: 10, gap: 8, marginBottom: 5,
    shadowColor: "#45231B", shadowOpacity: 0.07, shadowRadius: 6, elevation: 2 },
  orderHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusPill: { backgroundColor: "#F5EFE6", borderRadius: 13,
    paddingVertical: 5, paddingHorizontal: 10 },
  statusPillUrgent: { backgroundColor: "#FFE5E9" },
  cardContent: { flexDirection: "row", alignItems: "center", gap: 7 },
  cardDishIcon: { width: adminDensity.orderThumb, height: adminDensity.orderThumb,
    borderRadius: 9, backgroundColor: "#FFF1DF",
    alignItems: "center", justifyContent: "center" },
  cardProducts: { flex: 1, minWidth: 0, gap: 2 },
  productLine: { fontSize: 12, color: c.ink, fontWeight: "600", lineHeight: 17 },
  cardTotal: { alignItems: "flex-end", gap: 3 },
  paymentChip: { color: "#8E581B", backgroundColor: "#FFF2D8",
    fontSize: 10, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  detailButton: { backgroundColor: "#FCE6E7", borderRadius: 9,
    minHeight: 44, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 10, paddingHorizontal: 12 },
  detailButtonLabel: { fontSize: 12, fontWeight: "800", color: c.redDeep },
  detailButtonArrow: { color: c.redDeep, fontSize: 21, marginLeft: "auto" },
  emptyIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#FCE6E7",
    alignItems: "center", justifyContent: "center" },
  emptyHeading: { fontSize: 14, fontWeight: "800", color: c.ink },
  detailStatusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cancelInfo: { borderRadius: 10, padding: 10, gap: 5, backgroundColor: "#FFF0F1",
    borderWidth: 1, borderColor: "#F6CDD2" },
  cancelTitle: { color: "#B31E30", fontWeight: "800", fontSize: 13 },
  cancelText: { color: c.ink, fontSize: 12, lineHeight: 19 },
  timeline: { backgroundColor: "#FFF9F3", paddingVertical: 10, paddingHorizontal: 6,
    flexDirection: "row", borderRadius: 12, borderWidth: 1, borderColor: "#F2E7D9" },
  timelineStep: { flex: 1, alignItems: "center", gap: 4 },
  timelineDot: { width: 27, height: 27, borderRadius: 14, backgroundColor: "#E5E5E9",
    alignItems: "center", justifyContent: "center" },
  timelineDone: { backgroundColor: c.red },
  timelineLabel: { color: c.secondary, fontSize: 10, textAlign: "center", fontWeight: "600" },
  timelineLabelDone: { color: c.red, fontWeight: "800" },
  timelineClock: { color: c.secondary, fontSize: 10 },
  detailSectionTitle: { fontSize: 15, fontWeight: "800", color: c.ink,
    paddingLeft: 9, borderLeftWidth: 4, borderLeftColor: c.red },
  detailSectionRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  customerNoteBox: { gap: 4, padding: 10, borderRadius: 10, backgroundColor: "#FFF8EC",
    borderWidth: 1, borderColor: "#F1DFC0" },
  customerNoteTitle: { color: c.redDeep, fontSize: font.note, fontWeight: "900" },
  customerNoteText: { color: c.ink, fontSize: font.body, lineHeight: 20 },
  inlineEdit: { marginLeft: "auto", minHeight: 44, justifyContent: "center",
    paddingHorizontal: 12, borderRadius: 10, backgroundColor: "#FCE6E7" },
  inlineEditText: { color: c.redDeep, fontWeight: "800", fontSize: 12 },
  editPanel: { gap: 10, paddingVertical: 4 },
  editHint: { fontSize: font.note, lineHeight: 18, color: c.secondary,
    backgroundColor: "#FFF8EC", padding: 9, borderRadius: 9 },
  editLine: { gap: 8, borderWidth: 1, borderColor: c.line, borderRadius: 12,
    padding: 10, backgroundColor: c.white },
  editWarning: { color: c.red, fontSize: font.note, fontWeight: "700", marginTop: 2 },
  removeLine: { minHeight: 44, justifyContent: "center", paddingHorizontal: 10 },
  removeLineText: { color: c.red, fontWeight: "800", fontSize: 12 },
  quantityRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  qtyButton: { width: 44, height: 44, borderRadius: 10, backgroundColor: "#F5EFE6",
    alignItems: "center", justifyContent: "center" },
  disabledButton: { opacity: 0.35 },
  qtyText: { fontSize: 19, fontWeight: "800", color: c.redDeep },
  qtyValue: { minWidth: 28, textAlign: "center", fontWeight: "800", color: c.ink },
  editChoices: { gap: 6 },
  modifierRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6,
    borderBottomWidth: 1, borderBottomColor: c.line },
  modifierName: { flex: 1, fontSize: font.note, color: c.ink, fontWeight: "600" },
  addProductPanel: { gap: 6, borderTopWidth: 1, borderColor: c.line, paddingTop: 8 },
  productPick: { minHeight: 44, flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", gap: 8, paddingHorizontal: 8,
    borderBottomWidth: 1, borderBottomColor: c.line },
  itemOrdinal: { alignItems: "center", justifyContent: "center", width: 24, height: 24,
    borderRadius: 12, backgroundColor: "#FCE5E7" },
  itemOrdinalLabel: { fontSize: 12, fontWeight: "800", color: c.red },
});
