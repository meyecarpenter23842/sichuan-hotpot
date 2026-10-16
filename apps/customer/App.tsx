import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, AppState, KeyboardAvoidingView, Linking, Modal, Platform, Pressable,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, View, Image, useWindowDimensions,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Location from "expo-location";
import {
  addCartLine, setCartQuantity, cartModifierCount, cartComboOptionCount,
  replaceCartLineSelection, type CartLine,
} from "../../packages/shared/src/cart";
import {
  apiRequest, ApiRequestError, safeProductImageUrl, type AuthTokens, type BranchMenu, type BranchSummary,
  type Principal, type Product, type ModifierGroup, type ComboGroup,
  type SavedAddress, type SavedAddresses, type HomeOffer, type HomeHeroPayload, type HomePopupPayload,
  type CheckoutReceipt, type CustomerOrderDetail,
} from "./src/api";
import { addressError, optionSelectionError, phoneError, vnd } from "./src/validation";
import { comboSelectionDeltaVnd, comboSelectionError } from "./src/combo";
import { AuthScreen } from "./src/screens/AuthScreen";
import { CheckoutPanel } from "./src/screens/CheckoutPanel";
import { OrdersScreen } from "./src/screens/OrdersScreen";
import { PurchasedProductsScreen } from "./src/screens/PurchasedProductsScreen";
import { palette, typeScale } from "./src/theme";
import { HotpotNavIcon } from "./src/components/HotpotNavIcon";
import { HomeCategoryIcon, type HomeCategoryName } from "./src/components/HomeCategoryIcon";
import { HomeHeroCarousel } from "./src/components/HomeHeroCarousel";
import { HomePromoPopup } from "./src/components/HomePromoPopup";
import { AddressPinMap } from "./src/components/AddressPinMap";
import { VietnamAdministrativeAreaPicker } from "../../packages/ui/src/VietnamAdministrativeAreaPicker";
import { ADMIN_CATALOG_VERSION, displayAdministrativeSelection,
  validateAdministrativeSelection, approximateWardDistanceKm } from "../../packages/shared/src/vietnam-admin";
import { actionDepth } from "./src/components/action-depth";
import { startBrowserSession, refreshBrowserSession, endBrowserSession } from "./src/auth/browser-session";

type Screen = "home" | "menu" | "detail" | "cart" | "account" | "orders" | "login" | "address" | "purchased";
type AddressDraft = {
  label: string; phone: string; line1: string; latitude: string; longitude: string;
  catalogVersion?: string | null; provinceCode?: string | null; wardCode?: string | null;
};
const CART_KEY = "hotpot.cart.v1";
const BRANCH_KEY = "hotpot.branch.v1";
const ADDRESS_KEY = "hotpot.address.draft.v1";
const REFRESH_KEY = "hotpot.auth.refresh.v1";
const WEB_SESSION_MARKER = "hotpot.auth.pwa.present.v1";
async function writeRefresh(token: string): Promise<void> {
  if (Platform.OS === "web") {
    await startBrowserSession(token);
    await AsyncStorage.setItem(WEB_SESSION_MARKER, "1").catch(() => undefined);
  } else await SecureStore.setItemAsync(REFRESH_KEY, token);
}
async function clearRefresh(): Promise<void> {
  if (Platform.OS === "web") {
    // Never retain the local signed-in marker after a failed/offline logout.
    await AsyncStorage.multiRemove([REFRESH_KEY, WEB_SESSION_MARKER]).catch(() => undefined);
    await endBrowserSession();
  } else {
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  }
}
async function refreshCredentials(): Promise<AuthTokens | null> {
  if (Platform.OS === "web") {
    // This non-secret marker avoids hammering /refresh for anonymous visitors.
    if (await AsyncStorage.getItem(WEB_SESSION_MARKER).catch(() => null) !== "1") return null;
    const token = await refreshBrowserSession();
    return { ...token, refreshToken: "" };
  }
  const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  if (!refreshToken) return null;
  const tokens = await apiRequest<AuthTokens>("/auth/refresh", {
    method: "POST", body: { refreshToken },
  });
  await writeRefresh(tokens.refreshToken);
  return tokens;
}
const brand = palette.red;
const apiMissingMessage = "Chưa kết nối máy chủ. Vui lòng kiểm tra cấu hình API và thử lại.";

function Button({ label, onPress, disabled = false, alternate = false }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  alternate?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [
        styles.button, alternate ? actionDepth.secondary : actionDepth.primary,
        alternate && styles.buttonOutline, disabled && styles.buttonDisabled,
        pressed && !disabled && [styles.pressed, actionDepth.pressed],
      ]}
    >
      <Text style={[styles.buttonText, alternate && styles.buttonOutlineText]}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChangeText, placeholder, secureTextEntry = false, keyboardType = "default" }: {
  label: string; value: string; onChangeText: (text: string) => void;
  placeholder?: string; secureTextEntry?: boolean;
  keyboardType?: "default" | "phone-pad" | "decimal-pad";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input} value={value} onChangeText={onChangeText}
        placeholder={placeholder} placeholderTextColor="#98A2B3"
        secureTextEntry={secureTextEntry} keyboardType={keyboardType}
        autoCapitalize="none" autoCorrect={false}
        accessibilityLabel={label}
      />
    </View>
  );
}

function Notice({ message, error = false }: { message: string; error?: boolean }) {
  return (
    <View style={[styles.notice, error && styles.noticeError]} accessibilityRole="alert">
      <Text style={styles.noticeText}>{message}</Text>
    </View>
  );
}

function IconTile({ name }: { name: string }) {
  const type: HomeCategoryName = /trà|tea|sữa|drink/i.test(name) ? "milkTea"
    : /combo|set/i.test(name) ? "combo"
    : /topping|rau|nấm/i.test(name) ? "topping" : "hotpot";
  return (
    <View style={[styles.iconTile, type === "milkTea" && styles.iconTileTea]}>
      <HomeCategoryIcon name={type} size={52} />
    </View>
  );
}


function ProductArtwork({ product, large = false }: { product: Product; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  const uri = safeProductImageUrl(product.imageKey);
  useEffect(() => setBroken(false), [uri]);
  if (!uri || broken) return <IconTile name={product.name} />;
  return <Image source={{ uri }} resizeMode="cover"
    style={large ? styles.productImageLarge : styles.productImage}
    accessibilityLabel={"Ảnh món " + product.name} onError={() => setBroken(true)} />;
}

/** Optional toppings are purchased independently from the dish counter.
 * Required preparation choices apply to every dish portion. */
function selectedModifierPrice(product: Product, ids: readonly string[]): number {
  const prices = new Map((product.modifierGroups??[])
    .filter(group=>group.minSelect===0)
    .flatMap(group=>group.options.map(option=>[option.id,option.priceDeltaVnd] as const)));
  return ids.reduce((sum,id)=>sum+(prices.get(id)??0),0);
}
function cartPriceParts(product: Product, variantId: string|null,
  ids:readonly string[], comboOptionIds:readonly string[], quantity:number) {
  const variant=product.variants.find(v=>v.id===variantId);
  const baseUnit=product.priceVnd+(variant?.priceDeltaVnd??0);
  const dishTotal=baseUnit*quantity;
  const comboUnit=comboSelectionDeltaVnd(product,comboOptionIds);
  const comboTotal=comboUnit*quantity;
  const requiredUnit=(product.modifierGroups??[]).filter(g=>g.minSelect>0)
    .flatMap(group=>group.options)
    .reduce((sum,option)=>sum+
      ids.filter(id=>id===option.id).length*option.priceDeltaVnd,0);
  const requiredTotal=requiredUnit*quantity;
  const toppingTotal=selectedModifierPrice(product,ids);
  return {baseUnit,dishTotal,comboUnit,comboTotal,requiredTotal,toppingTotal,
    total:dishTotal+comboTotal+requiredTotal+toppingTotal};
}

function CustomerApp() {
  const { width: viewportWidth } = useWindowDimensions();
  const [screen, setScreen] = useState<Screen>("login");
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [branchId, setBranchId] = useState("");
  const [menu, setMenu] = useState<BranchMenu | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [offers,setOffers]=useState<HomeOffer[]>([]);
  const [offerLoading,setOfferLoading]=useState(false);
  const [offerError,setOfferError]=useState("");
  const [selectedOffer,setSelectedOffer]=useState<HomeOffer|null>(null);
  const [homeHero,setHomeHero]=useState<HomeHeroPayload|null>(null);
  const [heroLoading,setHeroLoading]=useState(false);
  const [heroError,setHeroError]=useState("");
  const [homePopup,setHomePopup]=useState<HomePopupPayload|null>(null);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([]);
  const [selectedComboOptionIds, setSelectedComboOptionIds] = useState<string[]>([]);
  const [detailError, setDetailError] = useState("");
  const [productInfoExpanded, setProductInfoExpanded] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [expandedCartGroups,setExpandedCartGroups]=useState<string[]>([]);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authRestoreError, setAuthRestoreError] = useState("");
  const [authRestoreAttempt, setAuthRestoreAttempt] = useState(0);
  const [accessExpiresAt, setAccessExpiresAt] = useState(0);
  const authEpoch = useRef(0);
  const renewing = useRef(false);
  const refreshFailures = useRef(0);
  const [retryAt, setRetryAt] = useState(0);
  const [loginReturnTo, setLoginReturnTo] = useState<"home" | "cart" | "account">("home");
  const [address, setAddress] = useState<AddressDraft>({
    label: "Nhà", phone: "", line1: "", latitude: "", longitude: "",
  });
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [focusOrderId, setFocusOrderId] = useState<string | null>(null);
  const [addressReturnTo, setAddressReturnTo] = useState<"cart" | "account">("cart");
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressSaving, setAddressSaving] = useState(false);
  const [pendingDeleteAddress, setPendingDeleteAddress] = useState<SavedAddress | null>(null);
  const [addressErrorText, setAddressErrorText] = useState("");
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const addressEditorOrigin = useRef<Screen>("account");
  const addressBeforeModal = useRef<AddressDraft | null>(null);

  const catalogueRequest = useRef(0);
  const currentBranch = useRef("");
  const loadedOffersForBranch=useRef("");
  const loadedHeroForBranch=useRef("");
  const loadedPopupForBranch=useRef("");

  // Catalog is an independently changing server resource. Recheck branch
  // visibility and products, including after the Admin toggles availability.
  // Ignore out-of-order HTTP responses when users switch branches rapidly.
  const refreshCatalogue = useCallback(async (requestedBranch?: string, silent = false) => {
    const requestId = ++catalogueRequest.current;
    if (requestedBranch) currentBranch.current = requestedBranch;
    if (!silent) setCatalogLoading(true);
    try {
      const [list, savedId] = await Promise.all([
        apiRequest<BranchSummary[]>("/catalog/branches"),
        AsyncStorage.getItem(BRANCH_KEY).catch(() => null),
      ]);
      if (requestId !== catalogueRequest.current) return;
      setBranches(list);
      const selection = requestedBranch ?? currentBranch.current;
      const activeBranch = list.find(branch => branch.id === selection)?.id
        ?? list.find(branch => branch.id === savedId)?.id ?? list[0]?.id;
      if (!activeBranch) {
        setMenu(null);
        setOffers([]);
        loadedOffersForBranch.current="";
        setOfferError("");
        setHomeHero(null);loadedHeroForBranch.current="";setHeroError("");
      setHomePopup(null);loadedPopupForBranch.current="";
        setHomePopup(null);loadedPopupForBranch.current="";
        setBranchId("");
        setCategoryId("");
        setCatalogError("");
        currentBranch.current = "";
        return;
      }
      const response = await apiRequest<BranchMenu>(
        "/catalog/branches/" + encodeURIComponent(activeBranch),
      );
      if (requestId !== catalogueRequest.current) return;
      currentBranch.current = activeBranch;
      setBranchId(activeBranch);
      setMenu(response);
      setCatalogError("");
      // Editorial promos load independently: failure may not hide menu/checkout.
      setOfferLoading(true);
      if(loadedOffersForBranch.current!==activeBranch){
        // Do not flicker the carousel during 30s/foreground refresh.
        // Only reset it when the customer actually switches branches.
        loadedOffersForBranch.current=activeBranch;
        setSelectedOffer(null);setOffers([]);
      }
      void apiRequest<HomeOffer[]>("/catalog/branches/"+
        encodeURIComponent(activeBranch)+"/offers").then(list=>{
        if(requestId!==catalogueRequest.current)return;
        setOffers(list);setOfferError("");
      }).catch(error=>{
        if(requestId!==catalogueRequest.current)return;
        setOffers([]);
        setOfferError(error instanceof Error?error.message:"Không tải được ưu đãi.");
      }).finally(()=>{
        if(requestId===catalogueRequest.current)setOfferLoading(false);
      });
      setHeroLoading(true);
      if(loadedHeroForBranch.current!==activeBranch){
        loadedHeroForBranch.current=activeBranch;setHomeHero(null);
      }
      void apiRequest<HomeHeroPayload>("/catalog/branches/"+
        encodeURIComponent(activeBranch)+"/hero").then(result=>{
        if(requestId!==catalogueRequest.current)return;
        setHomeHero(result);setHeroError("");
      }).catch(error=>{
        if(requestId!==catalogueRequest.current)return;
        setHomeHero(null);
        setHeroError(error instanceof Error?error.message:"Không tải được banner trang chủ.");
      }).finally(()=>{
        if(requestId===catalogueRequest.current)setHeroLoading(false);
      });
      if(loadedPopupForBranch.current!==activeBranch){
        loadedPopupForBranch.current=activeBranch;setHomePopup(null);
      }
      void apiRequest<HomePopupPayload>("/catalog/branches/"+
        encodeURIComponent(activeBranch)+"/popup").then(result=>{
        if(requestId!==catalogueRequest.current)return;
        setHomePopup(result);
      }).catch(()=>{
        if(requestId!==catalogueRequest.current)return;
        setHomePopup(null);
      });
      setCategoryId(old => response.categories.some(cat => cat.id === old)
        ? old : "");
      await AsyncStorage.setItem(BRANCH_KEY, activeBranch).catch(() => {
        if (requestId === catalogueRequest.current)
          setNotice("Không thể lưu chi nhánh. Vui lòng kiểm tra dung lượng thiết bị.");
      });
    } catch (error) {
      if (requestId !== catalogueRequest.current) return;
      setCatalogError(error instanceof Error ? error.message : apiMissingMessage);
      // Fail closed, never imply that stale stock/prices are currently for sale.
      setMenu(null);
      setOffers([]);loadedOffersForBranch.current="";
      setOfferError("");setSelectedOffer(null);
      setHomeHero(null);loadedHeroForBranch.current="";setHeroError("");
    } finally {
      if (requestId === catalogueRequest.current) setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!["home", "menu", "detail", "cart"].includes(screen)) return;
    const refreshIfVisible = () => {
      if (Platform.OS === "web"
        ? typeof document !== "undefined" && document.visibilityState === "visible"
        : AppState.currentState === "active") {
        void refreshCatalogue(undefined, true);
      }
    };
    // On entering the Home/Menu, when tab returns to foreground and every
    // 30 seconds while visible. Normal manual refresh still shows loading.
    refreshIfVisible();
    const timer = setInterval(refreshIfVisible, 30000);
    const listener = AppState.addEventListener("change", state => {
      if (state === "active") refreshIfVisible();
    });
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", refreshIfVisible);
    }
    return () => {
      clearInterval(timer);
      listener.remove();
      if (Platform.OS === "web" && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", refreshIfVisible);
      }
    };
  }, [screen, refreshCatalogue]);

  useEffect(() => { void refreshCatalogue(); }, [refreshCatalogue]);

  useEffect(() => {
    let mounted = true;
    async function restoreDrafts() {
      try {
        const [savedCart, savedAddress] = await Promise.all([
          AsyncStorage.getItem(CART_KEY), AsyncStorage.getItem(ADDRESS_KEY),
        ]);
        if (!mounted) return;
        if (savedCart) {
          const parsed: unknown = JSON.parse(savedCart);
          if (Array.isArray(parsed)) {
            let clean: CartLine[] = [];
            for (const raw of parsed.slice(0, 100)) {
              if (!raw || typeof raw !== "object" || !("selection" in raw)
                  || !("quantity" in raw) || !("key" in raw)) continue;
              try {
                const line = raw as CartLine;
                clean = addCartLine(clean, line.selection, line.quantity);
              } catch { /* Ignore malformed or obsolete on-device lines. */ }
            }
            setCart(clean);
          }
        }
        if (savedAddress) {
          const draft: unknown = JSON.parse(savedAddress);
          if (draft && typeof draft === "object" && "line1" in draft) {
            const candidate = draft as Partial<AddressDraft>;
            setAddress({
              label: typeof candidate.label === "string" ? candidate.label : "Nhà",
              phone: typeof candidate.phone === "string" ? candidate.phone : "",
              line1: typeof candidate.line1 === "string" ? candidate.line1 : "",
              latitude: typeof candidate.latitude === "string" ? candidate.latitude : "",
              longitude: typeof candidate.longitude === "string" ? candidate.longitude : "",
              catalogVersion: typeof candidate.catalogVersion === "string" ? candidate.catalogVersion : null,
              provinceCode: typeof candidate.provinceCode === "string" ? candidate.provinceCode : null,
              wardCode: typeof candidate.wardCode === "string" ? candidate.wardCode : null,
            });
          }
        }
      } catch {
        if (mounted) setNotice("Không thể khôi phục giỏ hàng đã lưu trên thiết bị.");
      } finally {
        if (mounted) setCartLoaded(true);
      }
    }
    void restoreDrafts();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!cartLoaded) return;
    AsyncStorage.setItem(CART_KEY, JSON.stringify(cart)).catch(() => {
      setNotice("Không thể lưu giỏ hàng. Vui lòng kiểm tra dung lượng thiết bị.");
    });
  }, [cart, cartLoaded]);

  useEffect(() => {
    let active = true;
    const epoch = authEpoch.current;
    async function restoreSession() {
      setAuthReady(false);
      if (Platform.OS === "web") await AsyncStorage.removeItem(REFRESH_KEY).catch(() => undefined);
      setAuthRestoreError("");
      try {
        const tokens = await refreshCredentials();
        if (!tokens) return;
        const who = await apiRequest<Principal>("/auth/me", {
          accessToken: tokens.accessToken,
        });
        if (who.role !== "CUSTOMER") throw new Error("Tài khoản không thuộc ứng dụng khách hàng.");
        if (active && epoch === authEpoch.current) {
          setAccessToken(tokens.accessToken);
          setPrincipal(who);
          setAccessExpiresAt(Date.now() + tokens.accessTokenExpiresInSeconds * 1000);
          setScreen("home");
        }
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) {
          // Missing browser cookie is the ordinary signed-out state.
          if (Platform.OS === "web") {
            await AsyncStorage.removeItem(WEB_SESSION_MARKER).catch(() => undefined);
          } else await clearRefresh().catch(() => undefined);
        } else if (active) {
          setAuthRestoreError(error instanceof Error ? error.message : "Không thể khôi phục phiên.");
        }
      } finally {
        if (active && epoch === authEpoch.current) setAuthReady(true);
      }
    }
    void restoreSession();
    return () => { active = false; };
  }, [authRestoreAttempt]);

  const saveLogin = useCallback(async (tokens: AuthTokens) => {
    const who = await apiRequest<Principal>("/auth/me", { accessToken: tokens.accessToken });
    if (who.role !== "CUSTOMER") throw new Error("Tài khoản này không thuộc ứng dụng khách hàng.");
    await writeRefresh(tokens.refreshToken);
    authEpoch.current += 1;
    refreshFailures.current = 0;
    setRetryAt(0);
    setAuthRestoreError("");
    setAccessToken(tokens.accessToken);
    setPrincipal(who);
    setAccessExpiresAt(Date.now() + tokens.accessTokenExpiresInSeconds * 1000);
    setScreen(loginReturnTo);
    setNotice(loginReturnTo === "cart" ? "Đăng nhập thành công. Vui lòng kiểm tra địa chỉ giao hàng." : "Đăng nhập thành công.");
  }, [loginReturnTo]);

  const renewSession = useCallback(async () => {
    if (renewing.current) return;
    renewing.current = true;
    const epoch = authEpoch.current;
    try {
      const tokens = await refreshCredentials();
      if (!tokens || epoch !== authEpoch.current) return;
      refreshFailures.current = 0;
      setRetryAt(0);
      setAccessToken(tokens.accessToken);
      setAccessExpiresAt(Date.now() + tokens.accessTokenExpiresInSeconds * 1000);
    } catch (error) {
      if (epoch !== authEpoch.current) return;
      if (error instanceof ApiRequestError && error.status === 401) {
        await clearRefresh().catch(() => undefined);
        setAccessToken("");
        setPrincipal(null);
        setAccessExpiresAt(0);
        setScreen("login");
        setNotice("Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.");
      } else {
        // Retain the credential. Exponential retry prevents a 1-second refresh storm.
        const delay = Math.min(300_000, 15_000 * 2 ** Math.min(refreshFailures.current, 5));
        refreshFailures.current += 1;
        setRetryAt(Date.now() + delay);
        setNotice("Mạng gián đoạn. Ứng dụng sẽ thử kết nối lại.");
      }
    } finally {
      renewing.current = false;
    }
  }, []);

  useEffect(() => {
    if (!accessToken || !accessExpiresAt) return;
    const refresh = () => {
      if (Date.now() + 60_000 >= accessExpiresAt && Date.now() >= retryAt) {
        void renewSession();
      }
    };
    const scheduleAt = Math.max(retryAt, accessExpiresAt - 60_000);
    const timeout = setTimeout(() => { void renewSession(); },
      Math.max(1000, scheduleAt - Date.now()));
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") refresh();
    });
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", refresh);
    }
    return () => {
      clearTimeout(timeout);
      subscription.remove();
      if (Platform.OS === "web" && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", refresh);
      }
    };
  }, [accessToken, accessExpiresAt, retryAt, renewSession]);

  async function signOut() {
    const token = accessToken;
    authEpoch.current += 1;
    setPrincipal(null);
    setAccessToken("");
    setAccessExpiresAt(0);
    setRetryAt(0);
    refreshFailures.current = 0;
    setSavedAddresses([]);
    setSelectedAddressId(null);
    setPendingDeleteAddress(null);
    setFocusOrderId(null);
    setAddress({ label: "Nhà", phone: "", line1: "", latitude: "", longitude: "" });
    const cleared = await Promise.allSettled([
      AsyncStorage.removeItem(ADDRESS_KEY),
      clearRefresh(),
      AsyncStorage.removeItem("hotpot.checkout.pending.v1"),
    ]);
    let revoked = cleared[1]?.status === "fulfilled";
    if (token && Platform.OS !== "web") {
      try { await apiRequest("/auth/logout", { method: "POST", accessToken: token }); }
      catch { revoked = false; }
    }
    setLoginReturnTo("home");
    setScreen("login");
    setNotice(revoked ? "Đã đăng xuất." : "Đã đăng xuất trên thiết bị. Máy chủ chưa xác nhận thu hồi phiên.");
  }

  useEffect(() => {
    if (!accessToken) { setSavedAddresses([]); setSelectedAddressId(null); return; }
    let active = true;
    apiRequest<SavedAddresses>("/customer/addresses", { accessToken })
      .then(result => {
        if (!active) return;
        setSavedAddresses(result.addresses);
        setSelectedAddressId(old => result.addresses.some(a => a.id === old)
          ? old : (result.addresses[0]?.id ?? null));
        setAddress(old => {
          const saved = result.addresses.find(a => a.id === selectedAddressId) ?? result.addresses[0];
          return saved
            ? { ...old, label: saved.label, line1: saved.line1,
                latitude: saved.latitude, longitude: saved.longitude,
                catalogVersion: saved.catalogVersion, provinceCode: saved.provinceCode,
                wardCode: saved.wardCode, phone: old.phone || result.phone || "" }
            : { ...old, phone: old.phone || result.phone || "" };
        });
      })
      .catch(() => { if (active) setNotice("Không thể tải địa chỉ đã lưu. Hãy thử lại."); });
    return () => { active = false; };
  }, [accessToken, selectedAddressId]);

  async function locateMe() {
    if (addressBusy) return;
    setAddressBusy(true);
    setAddressErrorText("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        throw new Error("Bạn chưa cho phép truy cập vị trí. Có thể nhập tọa độ thủ công.");
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setAddress(old => ({
        ...old, latitude: position.coords.latitude.toFixed(7),
        longitude: position.coords.longitude.toFixed(7),
      }));
      setNotice("Đã lấy GPS. Kiểm tra lại số nhà, tên đường và vị trí ghim trước khi đặt.");
    } catch (error) {
      setAddressErrorText(error instanceof Error ? error.message : "Không lấy được GPS.");
    } finally {
      setAddressBusy(false);
    }
  }

  async function saveAddress() {
    if (addressSaving) return;
    const error = phoneError(address.phone)
      || addressError(address.line1, address.latitude, address.longitude);
    if (error) { setAddressErrorText(error); return; }
    if (!validateAdministrativeSelection(address)) {
      setAddressErrorText("Vui lòng chọn lại Tỉnh/TP và Phường/Xã từ danh mục hiện hành.");
      return;
    }
    if (!address.label.trim() || address.label.trim().length > 100) {
      setAddressErrorText("Đặt tên gợi nhớ địa chỉ (tối đa 100 ký tự).");
      return;
    }
    setAddressSaving(true);
    setAddressErrorText("");
    try {
      if (principal && accessToken) {
        const saved = await apiRequest<SavedAddress>(editingAddressId
          ? "/customer/addresses/" + encodeURIComponent(editingAddressId)
          : "/customer/addresses", {
          method: editingAddressId ? "PATCH" : "POST", accessToken,
          body: { label: address.label, line1: address.line1,
            phone: address.phone.replace(/[\s.-]/g, ""),
            latitude: address.latitude, longitude: address.longitude,
            catalogVersion: address.catalogVersion, provinceCode: address.provinceCode,
            wardCode: address.wardCode },
        });
        if (editingAddressId) {
          setSavedAddresses(old => old.map(item => item.id === saved.id ? saved : item));
          if (selectedAddressId !== saved.id && addressBeforeModal.current) {
            setAddress({ ...addressBeforeModal.current, phone: address.phone });
          }
          setNotice("Đã cập nhật địa chỉ đã lưu. Phí giao sẽ được tính lại khi đặt hàng.");
        } else {
          setSavedAddresses(old => [saved, ...old]);
          setSelectedAddressId(saved.id);
          setNotice("Đã lưu địa chỉ vào tài khoản.");
        }
      } else {
        setNotice("Đã lưu bản nháp trên thiết bị. Đăng nhập để lưu nhiều địa chỉ.");
      }
      if (principal) {
        // Account-owned address is stored on backend, not plain-text device cache.
        await AsyncStorage.removeItem(ADDRESS_KEY).catch(() => undefined);
      } else {
        await AsyncStorage.setItem(ADDRESS_KEY, JSON.stringify(address));
      }
      setAddressModalOpen(false);
      setEditingAddressId(null);
      addressBeforeModal.current = null;
      setScreen(editingAddressId && addressEditorOrigin.current === "address" ? "address" : addressReturnTo);
    } catch (error) {
      setAddressErrorText(error instanceof Error ? error.message : "Không lưu được địa chỉ.");
    } finally { setAddressSaving(false); }
  }

  function selectSavedAddress(saved: SavedAddress, returnTo = addressReturnTo) {
    setSelectedAddressId(saved.id);
    setAddress(old => ({ ...old, label: saved.label, line1: saved.line1,
      latitude: saved.latitude, longitude: saved.longitude,
      catalogVersion: saved.catalogVersion, provinceCode: saved.provinceCode,
      wardCode: saved.wardCode }));
    setAddressErrorText("");
    setNotice("Đã chọn địa chỉ " + saved.label + ". Phí giao sẽ được tính lại khi đặt hàng.");
    setScreen(returnTo);
  }

  function openAddressEditor(returnTo: "cart" | "account", label = "Nhà") {
    if (principal && savedAddresses.length >= 10) {
      setNotice("Tài khoản đã lưu tối đa 10 địa chỉ. Xóa một địa chỉ cũ trước khi thêm.");
      return;
    }
    addressBeforeModal.current = address;
    addressEditorOrigin.current = screen;
    setEditingAddressId(null);
    setAddress({ label, phone: address.phone, line1: "", latitude: "", longitude: "",
      catalogVersion: ADMIN_CATALOG_VERSION, provinceCode: null, wardCode: null });
    setAddressReturnTo(returnTo);
    setAddressErrorText("");
    setAddressModalOpen(true);
  }

  function editSavedAddress(saved: SavedAddress, returnTo: "cart" | "account") {
    if (addressSaving) return;
    addressBeforeModal.current = address;
    addressEditorOrigin.current = screen;
    setEditingAddressId(saved.id);
    setAddress({ label: saved.label, phone: address.phone, line1: saved.line1,
      latitude: saved.latitude, longitude: saved.longitude,
      catalogVersion: saved.catalogVersion, provinceCode: saved.provinceCode,
      wardCode: saved.wardCode });
    setAddressReturnTo(returnTo);
    setAddressErrorText("");
    setAddressModalOpen(true);
  }

  function closeAddressEditor() {
    if (addressSaving) return;
    if (addressBeforeModal.current) setAddress(addressBeforeModal.current);
    addressBeforeModal.current = null;
    setEditingAddressId(null);
    setAddressErrorText("");
    setAddressModalOpen(false);
  }

  function showAddressPin(saved: SavedAddress) {
    const lat = Number(saved.latitude), lon = Number(saved.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      setNotice("Địa chỉ này chưa có tọa độ hợp lệ.");
      return;
    }
    void Linking.openURL("https://www.openstreetmap.org/?mlat=" + lat +
      "&mlon=" + lon + "#map=17/" + lat + "/" + lon)
      .catch(() => setNotice("Không mở được bản đồ ghim địa chỉ."));
  }

  function savedAddressCards(returnTo: "cart" | "account", compact = false) {
    // On the account overview always show the selected destination first.
    const selected = savedAddresses.find(item => item.id === selectedAddressId);
    const preview = selected
      ? [selected, ...savedAddresses.filter(item => item.id !== selected.id)]
      : savedAddresses;
    const displayed = compact ? preview.slice(0, 2) : savedAddresses;
    return displayed.map(saved => {
      const isSelected = selectedAddressId === saved.id;
      return (
        <View key={saved.id} style={[styles.savedAddress,
          isSelected && styles.savedAddressSelected]}>
          <View style={styles.addressRowIcon}>
            <HotpotNavIcon name="home" size={19} active={isSelected} />
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={"Dùng địa chỉ " + saved.label}
            accessibilityState={{ selected: isSelected }}
            style={({ pressed }) => [styles.addressCardCopy, pressed && styles.addressRowPressed]}
            onPress={() => selectSavedAddress(saved, returnTo)}>
            <View style={styles.addressLabelRow}>
              <Text style={styles.addressCardLabel} numberOfLines={1}>{saved.label}</Text>
              {isSelected && <Text style={styles.addressCurrentBadge}>Đang dùng</Text>}
            </View>
            <Text style={styles.addressCardLine} numberOfLines={2}>{saved.line1}</Text>
            <Text style={styles.muted} numberOfLines={1}>{displayAdministrativeSelection(saved) ?? "Cần chọn lại tỉnh/phường để đặt hàng"}</Text>
          </Pressable>
          <View style={styles.addressRowActions}>
            <Pressable accessibilityRole="button" accessibilityLabel={"Xem ghim " + saved.label}
              style={styles.addressPinButton} onPress={() => showAddressPin(saved)}>
              <Text style={styles.addressPinGlyph}>⌖</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={"Sửa địa chỉ " + saved.label}
              style={styles.addressSmallButton} disabled={addressSaving}
              accessibilityState={{ disabled: addressSaving }}
              onPress={() => editSavedAddress(saved, returnTo)}>
              <Text style={styles.addressEditGlyph}>Sửa</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={"Xóa địa chỉ " + saved.label}
              style={styles.addressSmallButton} disabled={addressSaving}
              accessibilityState={{ disabled: addressSaving }}
              onPress={() => { setAddressErrorText(""); setPendingDeleteAddress(saved); }}>
              <Text style={styles.addressDeleteGlyph}>Xóa</Text>
            </Pressable>
          </View>
        </View>
      );
    });
  }

  async function deleteSavedAddress(saved: SavedAddress) {
    if (!accessToken || addressSaving) return;
    setAddressSaving(true);
    try {
      await apiRequest("/customer/addresses/" + encodeURIComponent(saved.id), {
        method: "DELETE", accessToken,
      });
      setSavedAddresses(old => old.filter(x => x.id !== saved.id));
      setSelectedAddressId(old => old === saved.id
        ? (savedAddresses.find(x => x.id !== saved.id)?.id ?? null) : old);
      if (selectedAddressId === saved.id) {
        const replacement = savedAddresses.find(x => x.id !== saved.id);
        setAddress(old => replacement ? { ...old, label: replacement.label, line1: replacement.line1,
          latitude: replacement.latitude, longitude: replacement.longitude,
          catalogVersion: replacement.catalogVersion, provinceCode: replacement.provinceCode,
          wardCode: replacement.wardCode }
          : { ...old, line1: "", latitude: "", longitude: "",
            catalogVersion: ADMIN_CATALOG_VERSION, provinceCode: null, wardCode: null });
      }
      setPendingDeleteAddress(null);
      setNotice("Đã xóa địa chỉ đã lưu.");
    } catch (error) {
      setAddressErrorText(error instanceof Error ? error.message : "Không xóa được địa chỉ.");
    } finally { setAddressSaving(false); }
  }

  function openProduct(product: Product) {
    setSelectedProductId(product.id);
    setSelectedVariantId(null);
    setSelectedQuantity(1);
    setSelectedModifierIds([]);
    setSelectedComboOptionIds([]);
    setDetailError("");
    setProductInfoExpanded(false);
    setNotice("");
    setScreen("detail");
  }

  function changeDetailTopping(group: ModifierGroup, optionId: string, delta: number) {
    const inGroup = new Set(group.options.map(option => option.id));
    const currentGroupUnits = selectedModifierIds.filter(id => inGroup.has(id)).length;
    const currentUnits = selectedModifierIds.filter(id => id === optionId).length;
    const nextUnits = currentUnits + delta;
    if (nextUnits < 0 || (delta > 0 && (currentGroupUnits >= group.maxSelect ||
        selectedModifierIds.length >= 30))) {
      setDetailError("Nhóm "+group.name+" chỉ được chọn tối đa "+group.maxSelect+" topping.");
      return;
    }
    if (delta < 0 && currentGroupUnits <= group.minSelect) {
      setDetailError("Nhóm "+group.name+" cần tối thiểu "+group.minSelect+" topping.");
      return;
    }
    setDetailError("");
    setSelectedModifierIds(old => delta > 0
      ? [...old, optionId]
      : [...old.slice(0,old.indexOf(optionId)), ...old.slice(old.indexOf(optionId)+1)]);
  }

  function changeDetailCombo(group: ComboGroup, optionId: string, delta: number) {
    const current = selectedComboOptionIds.filter(id => id === optionId).length;
    const ids = new Set(group.options.map(option => option.id));
    const groupCount = selectedComboOptionIds.filter(id => ids.has(id)).length;
    const nextCount = current + delta;
    const swapping = delta > 0 && group.maxSelect === 1 && groupCount === 1 && current === 0;
    const nextGroupCount = groupCount + delta - (swapping ? 1 : 0);
    if (nextCount < 0 || nextGroupCount < group.minSelect || nextGroupCount > group.maxSelect
      || selectedComboOptionIds.length + delta - (swapping ? 1 : 0) > 30) {
      setDetailError("Nhóm " + group.name + " yêu cầu chọn từ " + group.minSelect
        + " đến " + group.maxSelect + " món.");
      return;
    }
    const option = group.options.find(item => item.id === optionId);
    if (!option?.childProduct.isAvailable) {
      setDetailError("Món này trong combo đang tạm hết."); return;
    }
    const remaining = selectedComboOptionIds.filter(id =>
      swapping ? !ids.has(id) : id !== optionId);
    setSelectedComboOptionIds([...remaining, ...Array(nextCount).fill(optionId)]);
    setDetailError("");
  }

  function changeCartTopping(line:CartLine, group:ModifierGroup, optionId:string, delta:number) {
    const current=cartModifierCount(line.selection,optionId);
    const option=group.options.find(x=>x.id===optionId);
    if(!option || (delta>0&&!option.isAvailable)){ setNotice("Topping này không còn bán.");return; }
    const ids=new Set(group.options.map(x=>x.id));
    const groupUnits=line.selection.modifierIds.filter(id=>ids.has(id)).length;
    const newCount=current+delta;
    const swapping=delta>0&&group.maxSelect===1&&groupUnits===1&&current===0;
    const nextGroupCount=groupUnits+delta-(swapping?1:0);
    if(newCount<0 || nextGroupCount<group.minSelect || nextGroupCount>group.maxSelect ||
        line.selection.modifierIds.length+delta-(swapping?1:0)>30) {
      setNotice("Nhóm "+group.name+" yêu cầu từ "+group.minSelect+
        " đến "+group.maxSelect+" topping trên mỗi phần.");
      return;
    }
    const remaining=line.selection.modifierIds.filter(id=>
      swapping?!ids.has(id):id!==optionId);
    const modifierIds=[...remaining,...Array(newCount).fill(optionId)];
    const product=productsById.get(line.selection.productId);
    if(!product) {setNotice("Món không còn bán.");return;}
    const error=optionSelectionError(product.modifierGroups,modifierIds);
    if(error){setNotice(error);return;}
    try {
      setCart(replaceCartLineSelection(cart,line.key,{...line.selection,modifierIds}));
      setNotice("Đã cập nhật topping trong giỏ. Tiền sẽ được máy chủ kiểm tra lại.");
    } catch(e) {
      setNotice(e instanceof Error?e.message:"Không cập nhật được topping.");
    }
  }

  function addSelectedProduct() {
    if (!selectedProduct || !selectedProduct.isAvailable) return;
    const selectionError = optionSelectionError(selectedProduct.modifierGroups ?? [], selectedModifierIds)
      ?? comboSelectionError(selectedProduct, selectedComboOptionIds);
    if (selectionError) { setDetailError(selectionError); return; }
    setDetailError("");
    try {
      setCart(old => addCartLine(old, {
        productId: selectedProduct.id, variantId: selectedVariantId,
        modifierIds: selectedModifierIds, comboOptionIds: selectedComboOptionIds,
      }, selectedQuantity));
      setScreen("menu");
      setNotice("Đã thêm món vào giỏ. Bạn có thể chọn tiếp hoặc mở giỏ khi sẵn sàng.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể thêm món.");
    }
  }

  const products = useMemo(() => menu?.categories.flatMap(cat => cat.products) ?? [], [menu]);
  const productsById = useMemo(
    () => new Map(products.map(product => [product.id, product])),
    [products],
  );
  const selectedProduct = selectedProductId ? productsById.get(selectedProductId) ?? null : null;
  const filteredCategories = useMemo(() => (
    menu?.categories.filter(cat => !categoryId || categoryId === cat.id)
      .map(cat => ({
        ...cat, products: cat.products.filter(product =>
          product.name.toLocaleLowerCase("vi").includes(search.toLocaleLowerCase("vi").trim())),
      })) ?? []
  ), [menu, categoryId, search]);
  const hasStoredAddress = !phoneError(address.phone)
    && !addressError(address.line1, address.latitude, address.longitude);

  function showProduct(product: Product) {
    return (
      <Pressable
        key={product.id} style={styles.productCard}
        accessibilityRole="button" accessibilityLabel={"Xem món " + product.name}
        onPress={() => openProduct(product)}
      >
        <ProductArtwork product={product} />
        <View style={styles.productInfo}>
          <View style={styles.productTitleRow}>
            <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
            {product.kind === "COMBO" && <Text style={styles.comboBadge}>COMBO</Text>}
          </View>
          <Text style={styles.price}>{vnd(product.priceVnd)}</Text>
          <Text style={styles.availability}>{product.isAvailable ? "Xem món và tùy chọn" : "Tạm hết hàng"}</Text>
        </View>
        <Text style={styles.forward}>›</Text>
      </Pressable>
    );
  }

  function cataloguePanel() {
    if (catalogLoading) return <ActivityIndicator size="large" color={brand} style={styles.loader} />;
    if (catalogError) {
      return <View style={styles.section}><Notice message={catalogError} error /><Button label="Thử tải lại thực đơn" onPress={() => void refreshCatalogue()} /></View>;
    }
    if (!menu || menu.categories.length === 0) {
      return <View style={styles.section}>
        <Text style={styles.emptyTitle}>Thực đơn đang được cập nhật</Text>
        <Text style={styles.muted}>Chi nhánh chưa mở bán hoặc chưa có món công khai. Kiểm tra chi nhánh trong Admin và thử làm mới.</Text>
        <Button label="Làm mới" onPress={() => void refreshCatalogue()} alternate />
      </View>;
    }
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Danh mục yêu thích</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pills}>
          <Pressable
            onPress={() => setCategoryId("")}
            style={[styles.pill, !categoryId && styles.pillActive]}
            accessibilityRole="button"
          ><Text style={[styles.pillText, !categoryId && styles.pillTextActive]}>Tất cả</Text></Pressable>
          {menu.categories.map(cat => (
            <Pressable
              key={cat.id} onPress={() => setCategoryId(cat.id)}
              accessibilityRole="button" style={[styles.pill, categoryId === cat.id && styles.pillActive]}
            >
              {safeProductImageUrl(cat.imageKey)
                ? <Image source={{uri:safeProductImageUrl(cat.imageKey)!}}
                    style={{width:24,height:24,borderRadius:6,marginRight:5}} accessibilityLabel={"Ảnh danh mục "+cat.name}/>
                : null}
              <Text style={[styles.pillText, categoryId === cat.id && styles.pillTextActive]}>{cat.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {filteredCategories.map(cat => (
          <View key={cat.id} style={styles.categoryBlock}>
            <View style={{flexDirection:"row",alignItems:"center",gap:8}}>
               {safeProductImageUrl(cat.imageKey)
                 ? <Image source={{uri:safeProductImageUrl(cat.imageKey)!}}
                     style={{width:32,height:32,borderRadius:8}} accessibilityLabel={"Ảnh danh mục "+cat.name}/>
                 : null}
               <Text style={styles.categoryTitle}>{cat.name}</Text>
             </View>
            {cat.products.length === 0
              ? <Text style={styles.muted}>Chưa có món phù hợp.</Text>
              : cat.products.map(showProduct)}
          </View>
        ))}
      </View>
    );
  }

  function orderPlaced(receipt: CheckoutReceipt) {
    setCart([]);
    setFocusOrderId(receipt.orderId);
    setNotice("Đã nhận đơn #" + receipt.orderId.slice(0, 8) + ". " +
      (receipt.paymentMethod === "COD"
        ? "Thanh toán tiền mặt khi giao."
        : "Thanh toán QR đang chờ xác nhận của cửa hàng."));
    setScreen("orders");
  }

  function reorder(order: CustomerOrderDetail): string | null {
    if (order.branchId !== branchId) return "Chọn đúng chi nhánh đã đặt trước khi đặt lại.";
    let updated = [...cart];
    for (const item of order.items) {
      const product = item.productId ? productsById.get(item.productId) : null;
      if (!product || !product.isAvailable) return "Có món đã ngừng bán, vui lòng chọn món mới.";
      const variants = item.variantName === null ? [] : product.variants.filter(v =>
        v.name === item.variantName && v.isAvailable);
      if (item.variantName !== null && variants.length !== 1) {
        return "Khẩu phần của đơn cũ đã thay đổi, vui lòng chọn lại trên thực đơn.";
      }
      const modifierIds: string[] = [];
      const available = product.modifierGroups.flatMap(group => group.options);
      for (const modifier of item.modifiers) {
        const matches = available.filter(v => v.name === modifier.name
          && v.isAvailable && v.priceDeltaVnd === modifier.priceVnd);
        if (matches.length !== 1) return "Topping đơn cũ đã thay đổi, vui lòng chọn lại.";
        // Duplicate snapshot rows preserve extra topping quantities.
        modifierIds.push(matches[0]!.id);
      }
      if (optionSelectionError(product.modifierGroups, modifierIds)) {
        return "Tùy chọn đơn cũ không còn hợp lệ, vui lòng chọn lại.";
      }
      try {
        updated = addCartLine(updated, {
          productId: product.id, variantId: variants[0]?.id ?? null, modifierIds,
        }, item.quantity);
      } catch {
        return "Giỏ hàng đã đầy hoặc số lượng vượt giới hạn.";
      }
    }
    setCart(updated);
    setNotice("Đã đưa món đang bán vào giỏ. Giá và phí giao sẽ được máy chủ tính lại.");
    setScreen("cart");
    return null;
  }

  function mainContent() {
    switch (screen) {

      case "home": {
        // Use live catalogue data; product photography, prices and stock come from API.
        const available = products.filter(item => item.isFeatured && item.isAvailable)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi"))
          .slice(0, 8);
        const quick: readonly { name: string; icon: HomeCategoryName; terms: readonly string[] }[] = [
          { name: "Lẩu", icon: "hotpot", terms: ["lẩu", "hotpot"] },
          { name: "Trà sữa", icon: "milkTea", terms: ["trà", "sữa", "drink"] },
          { name: "Combo", icon: "combo", terms: ["combo", "set"] },
          { name: "Topping", icon: "topping", terms: ["topping", "thêm", "nấm"] },
          { name: "Ưu đãi", icon: "offers", terms: ["ưu đãi", "khuyến mãi", "giảm giá"] },
        ];
        return (
          <View style={styles.homePage}>
            <View style={styles.homeHeroRegion} testID="home-approved-hero">
              <HomeHeroCarousel payload={homeHero} loading={heroLoading} error={heroError}
                active={screen==="home"} onRetry={()=>void refreshCatalogue(undefined,true)}
                onMenu={()=>{setCategoryId("");setScreen("menu");}}/>
            </View>
            <View style={styles.quickMenu}>
              {quick.map((item, index) => (
                <Pressable key={item.name} accessibilityRole="button"
                  accessibilityLabel={"Xem danh mục " + item.name}
                  style={[styles.quickItem, index === 0 ? styles.quickItemHotpot : styles.quickItemNeutral]}
                  onPress={() => {
                    const match = menu?.categories.find(cat =>
                      item.terms.some(term => cat.name.toLocaleLowerCase("vi").includes(term)));
                    setSearch("");
                    setCategoryId(match?.id ?? "");
                    setScreen("menu");
                  }}>
                  <HomeCategoryIcon name={item.icon} size={48} />
                  <Text style={styles.quickLabel} numberOfLines={1}>{item.name}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.homeSection}>
              <View style={styles.homeSectionHead}>
                <View style={styles.homeSectionTitleRow}>
                  <HomeCategoryIcon name="offers" size={26} />
                  <Text testID="home-section-title" style={styles.homeSectionTitle}>Món nổi bật</Text>
                </View>
                <Pressable accessibilityRole="button" onPress={() => { setCategoryId(""); setScreen("menu"); }}
                  style={styles.homeSeeAll}><Text style={styles.linkText}>Xem tất cả  ›</Text></Pressable>
              </View>
              {available.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.featureGrid}
                  style={styles.featureCarousel} testID="home-feature-carousel">
                  {available.map(item => (
                    <View key={item.id} style={styles.featureCard}>
                      <Pressable accessibilityRole="button" accessibilityLabel={"Xem món " + item.name}
                        onPress={() => openProduct(item)}>
                        <View style={styles.featureImage}><ProductArtwork product={item} large /></View>
                        <Text style={styles.featureTitle} numberOfLines={2}>{item.name}</Text>
                      </Pressable>
                      <View style={styles.featureFooter}>
                        <Text style={styles.featurePrice} numberOfLines={1}>{vnd(item.priceVnd)}</Text>
                        <Pressable style={styles.featureAddButton} accessibilityRole="button"
                          accessibilityLabel={"Chọn tùy chọn " + item.name}
                          onPress={() => openProduct(item)}>
                          <Text style={styles.featurePlus}>+</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <View style={styles.homeEmpty}>
                  <Text style={styles.emptyTitle}>Thực đơn đang cập nhật</Text>
                  <Text style={styles.muted}>
                    {catalogError ? "Chưa kết nối API thực đơn. Kiểm tra kết nối rồi thử lại." :
                      catalogLoading ? "Đang tải thực đơn từ cửa hàng..." :
                        "Chưa có món nổi bật đang bán. Xem thực đơn để chọn món khác."}
                  </Text>
                  {!!catalogError && <Button label="Thử kết nối lại" alternate onPress={() => void refreshCatalogue()} />}
                  {!catalogError && <Button label="Xem thực đơn" alternate onPress={() => setScreen("menu")} />}
                </View>
              )}
            </View>
            <View style={styles.homeOffers}>
              <View style={styles.homeSectionHead}>
                <View style={styles.homeSectionTitleRow}>
                  <HomeCategoryIcon name="combo" size={26}/>
                  <Text style={styles.homeSectionTitle}>Ưu đãi hôm nay</Text>
                </View>
              </View>
              {offers.length>0?<ScrollView horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.homeOfferGrid} testID="home-live-offers">
                {offers.map(offer=><Pressable key={offer.id} accessibilityRole="button"
                  accessibilityLabel={"Xem ưu đãi "+offer.title}
                  style={[styles.homeOfferCard,{width:Math.min(254,Math.max(158,viewportWidth*.58))}]}
                  onPress={()=>setSelectedOffer(offer)}>
                  {safeProductImageUrl(offer.imageKey)&&<Image resizeMode="cover"
                    source={{uri:safeProductImageUrl(offer.imageKey)!}}
                    style={styles.homeOfferImage}/>}
                  <View style={styles.homeOfferCardShade}>
                    <Text style={styles.homeOfferCardTitle} numberOfLines={1}>{offer.title}</Text>
                  </View>
                </Pressable>)}
              </ScrollView>:<View style={styles.homeOfferEmpty}>
                <Text style={styles.muted}>
                  {offerLoading?"Đang tải ưu đãi…":offerError
                    ?"Không tải được ưu đãi. Thực đơn vẫn hoạt động bình thường."
                    :"Hiện chưa có chương trình ưu đãi đang diễn ra."}
                </Text>
                {!!offerError&&<Button alternate label="Thử tải ưu đãi"
                  onPress={()=>void refreshCatalogue(undefined,true)}/>}
              </View>}
              <Text style={styles.homeOfferNote}>Nội dung chương trình do cửa hàng công bố. Giá đặt món được xác nhận trong giỏ.</Text>
            </View>
          </View>
        );
      }
      case "menu":
        return (
          <>
            <View style={styles.section}>
              <Text style={styles.pageTitle}>Thực đơn</Text>
              {branches.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {branches.map(branch => (
                    <Pressable key={branch.id} onPress={() => void refreshCatalogue(branch.id)}
                      style={[styles.branchPill, branchId === branch.id && styles.branchActive]}
                      accessibilityRole="button" accessibilityState={{ selected: branchId === branch.id }}>
                      <Text style={styles.branchText}>{branch.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : <Text style={styles.muted}>Chi nhánh đang được cập nhật.</Text>}
              {menu && !menu.isActive && <Notice message="Quán hiện đã nghỉ. Bạn vẫn có thể xem món và thêm vào giỏ; đặt hàng sẽ mở lại khi quán hoạt động." />}
              <Field label="Tìm món ăn, trà sữa" value={search} onChangeText={setSearch}
                placeholder="Nhập tên món bạn muốn tìm..." />
            </View>
            {cataloguePanel()}
          </>
        );
      case "orders":
        return <OrdersScreen accessToken={accessToken} focusOrderId={focusOrderId}
          onLogin={() => { setLoginReturnTo("account"); setScreen("login"); }}
          onReorder={reorder} />;
      case "detail": {
        const item = selectedProduct;
        if (!item) return <View style={styles.section}>
          <Notice message="Món vừa thay đổi hoặc chi nhánh đã ngừng bán. Vui lòng chọn lại từ thực đơn." error />
          <Button label="Trở lại thực đơn" alternate onPress={() => setScreen("menu")} />
        </View>;
        const costs=cartPriceParts(item,selectedVariantId,selectedModifierIds,
          selectedComboOptionIds,selectedQuantity);
        return (
          <View style={styles.section}>
            <Button label="‹ Trở lại thực đơn" alternate onPress={() => setScreen("menu")} />
            <View style={styles.detailHero}><ProductArtwork product={item} large /></View>
            <Text style={styles.detailTitle}>{item.name}</Text>
            <Text style={styles.detailPrice}>
              {item.kind === "COMBO" ? "Giá combo" : "Giá món"}: {vnd(costs.baseUnit)} / phần
            </Text>
            {(item.description || item.ingredients || item.productNotes || item.allergenNotice) &&
              <View style={styles.productContent}>
                {!!item.description && <Text style={styles.productDescription}
                  numberOfLines={productInfoExpanded ? undefined : 4}>{item.description}</Text>}
                {!!item.ingredients && <>
                  <Pressable accessibilityRole="button"
                    accessibilityLabel={(productInfoExpanded ? "Ẩn" : "Xem") + " thành phần " + item.name}
                    accessibilityState={{expanded: productInfoExpanded}}
                    style={styles.productInfoToggle}
                    onPress={() => setProductInfoExpanded(value => !value)}>
                    <Text style={styles.productInfoToggleText}>
                      {productInfoExpanded ? "Ẩn thành phần" : "Xem thành phần"}
                    </Text>
                    <Text style={styles.productInfoChevron}>{productInfoExpanded ? "⌃" : "⌄"}</Text>
                  </Pressable>
                  {productInfoExpanded && <View style={styles.productInfoSection}>
                    <Text style={styles.productInfoLabel}>Thành phần</Text>
                    <Text style={styles.productInfoText}>{item.ingredients}</Text>
                  </View>}
                </>}
                {!!item.productNotes && <View style={styles.productInfoSection}>
                  <Text style={styles.productInfoLabel}>Lưu ý</Text>
                  <Text style={styles.productInfoText}>{item.productNotes}</Text>
                </View>}
                {!!item.allergenNotice && <View style={styles.allergenNotice}>
                  <Text style={styles.allergenTitle}>Thông tin dị ứng</Text>
                  <Text style={styles.allergenText}>{item.allergenNotice}</Text>
                  <Text style={styles.allergenSource}>Thông tin do cửa hàng cung cấp; nếu cần, hãy hỏi cửa hàng trước khi đặt.</Text>
                </View>}
              </View>}
            {item.kind === "COMBO" && <View style={styles.comboSection}>
              <View style={styles.comboHeading}>
                <Text style={styles.sectionTitle}>Combo gồm</Text>
                <Text style={styles.comboBadge}>COMBO</Text>
              </View>
              {item.comboFixedItems.map(fixed => <View key={fixed.id} style={styles.comboFixedRow}>
                {safeProductImageUrl(fixed.childProduct.imageKey)
                  ? <Image source={{ uri: safeProductImageUrl(fixed.childProduct.imageKey)! }}
                      style={styles.comboThumb} />
                  : <View style={styles.comboThumbPlaceholder} />}
                <View style={styles.toppingCopy}>
                  <Text style={styles.optionText}>{fixed.quantity} × {fixed.childProduct.name}</Text>
                  {!fixed.childProduct.isAvailable &&
                    <Text style={styles.warning}>Món này đang tạm hết</Text>}
                </View>
              </View>)}
              {item.comboGroups.map((group: ComboGroup) => {
                const ids = new Set(group.options.map(option => option.id));
                const groupCount = selectedComboOptionIds.filter(id => ids.has(id)).length;
                const required = group.minSelect > 0;
                return <View key={group.id} style={[styles.group, required && styles.requiredGroup]}>
                  <View style={styles.choiceGroupHeading}>
                    <Text style={styles.sectionTitle}>{group.name}</Text>
                    <Text style={[styles.choiceRequirement, required && styles.choiceRequired]}>
                      {required ? "Bắt buộc" : "Không bắt buộc"}
                    </Text>
                  </View>
                  <Text style={styles.muted}>Chọn {group.minSelect}–{group.maxSelect} món · hiện {groupCount}</Text>
                  {group.options.filter(option => option.childProduct.isAvailable).map(option => {
                    const count = selectedComboOptionIds.filter(id => id === option.id).length;
                    const atMax = groupCount >= group.maxSelect;
                    const wouldSwap = group.maxSelect === 1 && groupCount === 1 && count === 0;
                    return <View key={option.id} style={styles.comboChoiceRow}>
                      {safeProductImageUrl(option.childProduct.imageKey)
                        ? <Image source={{ uri: safeProductImageUrl(option.childProduct.imageKey)! }}
                            style={styles.comboThumb} />
                        : <View style={styles.comboThumbPlaceholder} />}
                      <View style={styles.toppingCopy}>
                        <Text style={styles.optionText} numberOfLines={2}>
                          {option.quantity} × {option.childProduct.name}
                        </Text>
                        <Text style={styles.optionPrice}>{option.priceDeltaVnd > 0
                          ? "+" + vnd(option.priceDeltaVnd) : "Trong giá combo"}</Text>
                      </View>
                      <View style={styles.quantityStepper}>
                        <Pressable style={styles.step} accessibilityRole="button"
                          accessibilityLabel={"Bớt " + option.childProduct.name}
                          disabled={count === 0 || groupCount <= group.minSelect}
                          onPress={() => changeDetailCombo(group, option.id, -1)}>
                          <Text style={styles.stepText}>−</Text>
                        </Pressable>
                        <Text style={styles.qtyText}>{count}</Text>
                        <Pressable style={styles.step} accessibilityRole="button"
                          accessibilityLabel={"Thêm " + option.childProduct.name}
                          disabled={(!wouldSwap && atMax) || selectedComboOptionIds.length >= 30}
                          onPress={() => changeDetailCombo(group, option.id, 1)}>
                          <Text style={styles.stepText}>+</Text>
                        </Pressable>
                      </View>
                    </View>;
                  })}
                  {groupCount < group.minSelect &&
                    <Text style={styles.warning}>Cần chọn thêm {group.minSelect - groupCount} món.</Text>}
                </View>;
              })}
            </View>}
            <Text style={styles.muted}>
              {item.kind === "COMBO" ? "Lựa chọn combo: " + vnd(costs.comboTotal) + " · " : ""}
              Topping thêm: {vnd(costs.toppingTotal)} · Độ cay/nhóm bắt buộc:
              {" "}{vnd(costs.requiredTotal)} · Tổng {selectedQuantity} phần: {vnd(costs.total)}</Text>
            <Text style={styles.muted}>Giá tạm tính; máy chủ xác nhận lại trước khi đặt.</Text>
            {item.variants.length > 0 && <View style={styles.group}>
              <Text style={styles.sectionTitle}>Khẩu phần / size</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.sizeStrip}>
                {[{id:null,name:"Mặc định",priceDeltaVnd:0},...item.variants.filter(v=>v.isAvailable)]
                  .map(variant=>{
                  const chosen=selectedVariantId===variant.id;
                  return <Pressable key={variant.id??"default"} accessibilityRole="radio"
                    accessibilityLabel={"Size "+variant.name}
                    accessibilityState={{checked:chosen}} aria-checked={chosen}
                    style={[styles.sizeTile,chosen&&styles.sizeTileSelected]}
                    onPress={()=>setSelectedVariantId(variant.id)}>
                    <Text style={[styles.sizeLabel,chosen&&styles.sizeLabelSelected]}>
                      {variant.name}</Text>
                    <Text style={[styles.sizePrice,chosen&&styles.sizeLabelSelected]}>
                      {variant.id===null?"Giá gốc":vnd(item.priceVnd+variant.priceDeltaVnd)}
                    </Text>
                  </Pressable>;
                })}
              </ScrollView>
            </View>}
            {[...(item.modifierGroups??[])].sort((a,b)=>
              Number(b.minSelect>0)-Number(a.minSelect>0)).map((group:ModifierGroup)=>{
              const mandatory=group.minSelect>0;
              const ids=new Set(group.options.map(o=>o.id));
              const groupCount=selectedModifierIds.filter(id=>ids.has(id)).length;
              return <View key={group.id} style={[styles.group,mandatory&&styles.requiredGroup]}>
                <View style={styles.choiceGroupHeading}>
                  <Text style={styles.sectionTitle}>{group.name}</Text>
                  <Text style={[styles.choiceRequirement,mandatory&&styles.choiceRequired]}>
                    {mandatory?"Bắt buộc":"Không bắt buộc"}
                  </Text>
                </View>
                <Text style={styles.muted}>
                  {mandatory?"Chọn ít nhất "+group.minSelect:"Có thể bỏ qua"} · Tối đa
                  {" "+group.maxSelect} topping mỗi phần
                </Text>
                {mandatory?<View style={styles.choiceWrap}>
                  {group.options.filter(option=>option.isAvailable).map(option=>{
                    const count=selectedModifierIds.filter(id=>id===option.id).length;
                    return <View key={option.id} style={[styles.requiredTile,
                      count>0&&styles.requiredTileSelected]}>
                      <Pressable style={styles.requiredTilePick}
                        accessibilityRole={group.maxSelect===1?"radio":"checkbox"}
                        accessibilityLabel={option.name}
                        accessibilityState={{checked:count>0}} aria-checked={count>0}
                        onPress={()=>{
                          if(group.maxSelect===1){
                            setSelectedModifierIds(old=>[...old.filter(id=>!ids.has(id)),option.id]);
                            setDetailError("");
                          }else changeDetailTopping(group,option.id,count>0?-1:1);
                        }}>
                        {safeProductImageUrl(option.imageKey)&&<Image
                          source={{uri:safeProductImageUrl(option.imageKey)!}}
                          style={styles.requiredImage}/>}
                        <Text style={styles.requiredTileName} numberOfLines={2}>{option.name}</Text>
                        {option.priceDeltaVnd>0&&<Text style={styles.sizePrice}>
                          +{vnd(option.priceDeltaVnd)}</Text>}
                        {group.maxSelect===1&&<Text style={styles.tileCheck}>{count>0?"✓":"○"}</Text>}
                      </Pressable>
                      {group.maxSelect>1&&<View style={styles.tileStepper}>
                        <Pressable style={styles.tileQtyButton} accessibilityRole="button"
                          accessibilityLabel={"Bớt "+option.name}
                          disabled={!count||groupCount<=group.minSelect}
                          onPress={()=>changeDetailTopping(group,option.id,-1)}>
                          <Text style={styles.stepText}>−</Text>
                        </Pressable>
                        <Text style={styles.qtyText}>{count}</Text>
                        <Pressable style={styles.tileQtyButton} accessibilityRole="button"
                          accessibilityLabel={"Thêm "+option.name}
                          disabled={groupCount>=group.maxSelect||selectedModifierIds.length>=30}
                          onPress={()=>changeDetailTopping(group,option.id,1)}>
                          <Text style={styles.stepText}>+</Text>
                        </Pressable>
                      </View>}
                    </View>;
                  })}
                </View>:group.options.filter(option=>option.isAvailable).map(option=>{
                  const count=selectedModifierIds.filter(id=>id===option.id).length;
                  return <View key={option.id} style={styles.toppingRow}>
                    {safeProductImageUrl(option.imageKey)
                      ?<Image source={{uri:safeProductImageUrl(option.imageKey)!}}
                        style={styles.toppingImage}/>
                      :<View style={styles.toppingPlaceholder}/>}
                    <View style={styles.toppingCopy}>
                      <Text style={styles.optionText} numberOfLines={2}>{option.name}</Text>
                      <Text style={styles.optionPrice}>{option.priceDeltaVnd>0
                        ? "+"+vnd(option.priceDeltaVnd):"0đ"}</Text>
                    </View>
                    <View style={styles.quantityStepper}>
                      <Pressable style={styles.step} accessibilityRole="button"
                        accessibilityLabel={"Bớt "+option.name} disabled={count===0}
                        onPress={()=>changeDetailTopping(group,option.id,-1)}>
                        <Text style={styles.stepText}>−</Text>
                      </Pressable>
                      <Text style={styles.qtyText}>{count}</Text>
                      <Pressable style={styles.step} accessibilityRole="button"
                        accessibilityLabel={"Thêm "+option.name}
                        disabled={(groupCount>=group.maxSelect
                          &&!(group.maxSelect===1&&count===0))
                          ||selectedModifierIds.length>=30}
                        onPress={()=>{
                          if(group.maxSelect===1&&groupCount===1){
                            setSelectedModifierIds(old=>[...old.filter(id=>!ids.has(id)),option.id]);
                          }else changeDetailTopping(group,option.id,1);
                        }}>
                        <Text style={styles.stepText}>+</Text>
                      </Pressable>
                    </View>
                  </View>;
                })}
              </View>;
            })}
            {!!detailError && <Notice message={detailError} error />}
            <View style={styles.quantityLine}>
              <Text style={styles.sectionTitle}>Số lượng</Text>
              <View style={styles.quantityStepper}>
                <Pressable style={styles.step} accessibilityRole="button" accessibilityLabel="Giảm số lượng"
                  onPress={() => setSelectedQuantity(q => Math.max(1, q - 1))}><Text style={styles.stepText}>−</Text></Pressable>
                <Text style={styles.qtyText}>{selectedQuantity}</Text>
                <Pressable style={styles.step} accessibilityRole="button" accessibilityLabel="Tăng số lượng"
                  onPress={() => setSelectedQuantity(q => Math.min(99, q + 1))}><Text style={styles.stepText}>+</Text></Pressable>
              </View>
            </View>
            <Button label={item.isAvailable ? "Thêm vào giỏ · " + vnd(costs.total) : "Món đang tạm hết"}
              disabled={!item.isAvailable} onPress={addSelectedProduct} />
          </View>
        );
      }
      case "cart":
        return (
          <View style={styles.section}>
            <Text style={styles.pageTitle}>Giỏ hàng</Text>
            {cart.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Chưa có món nào</Text>
                <Text style={styles.muted}>Xem thực đơn và chọn món ngon cho bữa ăn nhé.</Text>
                <Button label="Xem thực đơn" onPress={() => setScreen("menu")} />
              </View>
            ) : (
              <>
                {cart.map(line => {
                  const product=productsById.get(line.selection.productId);
                  const variant=product?.variants.find(v=>v.id===line.selection.variantId);
                  const groups=product?.modifierGroups??[];
                  const comboOptionIds=line.selection.comboOptionIds??[];
                  const unavailable=!product||!product.isAvailable
                    ||(line.selection.variantId!==null&&(!variant||!variant.isAvailable))
                    ||optionSelectionError(groups,line.selection.modifierIds)!==null
                    ||(product?comboSelectionError(product,comboOptionIds)!==null:true);
                  const costs=product?cartPriceParts(product,line.selection.variantId,
                    line.selection.modifierIds,line.selection.comboOptionIds??[],line.quantity):null;
                  return <View key={line.key} style={styles.cartLine}>
                    <View style={styles.cartLineHeading}>
                      <View style={styles.cartLineDetails}>
                        <Text style={styles.productName}>
                          {product?.name??"Món không còn trong thực đơn"}</Text>
                        <Text style={styles.muted}>
                          {product?.kind === "COMBO" ? "Combo" : "Size: " + (variant?.name??"Mặc định")}
                          {" · "}{costs?vnd(costs.baseUnit):"—"} / phần
                        </Text>
                      </View>
                      <View style={styles.quantityStepper}>
                        <Pressable style={styles.step} accessibilityRole="button"
                          accessibilityLabel={"Giảm số lượng món "+(product?.name??"")}
                          onPress={()=>setCart(old=>setCartQuantity(old,line.key,
                            Math.max(0,line.quantity-1)))}>
                          <Text style={styles.stepText}>−</Text>
                        </Pressable>
                        <Text style={styles.qtyText}>{line.quantity}</Text>
                        <Pressable style={styles.step} accessibilityRole="button"
                          accessibilityLabel={"Tăng số lượng món "+(product?.name??"")}
                          disabled={line.quantity>=99}
                          onPress={()=>setCart(old=>setCartQuantity(old,line.key,
                            Math.min(99,line.quantity+1)))}>
                          <Text style={styles.stepText}>+</Text>
                        </Pressable>
                      </View>
                    </View>
                    {product?.kind === "COMBO" && <View style={styles.cartGroup}>
                      <Text style={styles.cartGroupTitle}>Thành phần combo</Text>
                      {product.comboFixedItems.map(fixed =>
                        <Text key={fixed.id} style={styles.muted}>
                          • {fixed.quantity} × {fixed.childProduct.name}
                        </Text>)}
                      {product.comboGroups.map(group => {
                        const selected = group.options.filter(option =>
                          cartComboOptionCount(line.selection, option.id) > 0);
                        return selected.length ? <View key={group.id} style={styles.comboCartGroup}>
                          <Text style={styles.cartToppingName}>{group.name}</Text>
                          {selected.map(option => {
                            const count = cartComboOptionCount(line.selection, option.id);
                            return <Text key={option.id} style={styles.muted}>
                              • {option.quantity * count} × {option.childProduct.name}
                              {option.priceDeltaVnd > 0 ? " · +" + vnd(option.priceDeltaVnd * count) : ""}
                            </Text>;
                          })}
                        </View> : null;
                      })}
                    </View>}
                    {[...groups].sort((a,b)=>Number(b.minSelect>0)-Number(a.minSelect>0)).map(group=>{
                      const groupIds=new Set(group.options.map(o=>o.id));
                      const groupCount=line.selection.modifierIds.filter(id=>groupIds.has(id)).length;
                      const mandatory=group.minSelect>0;
                      const cartGroupKey=line.key+"|"+group.id;
                      const expanded=expandedCartGroups.includes(cartGroupKey);
                      const hasOtherOptions=group.options.some(o=>o.isAvailable
                        &&cartModifierCount(line.selection,o.id)===0);
                      return <View key={group.id} style={styles.cartGroup}>
                        <View style={styles.choiceGroupHeading}>
                          <Text style={styles.cartGroupTitle}>{group.name}</Text>
                          <Text style={[styles.choiceRequirement,mandatory&&styles.choiceRequired]}>
                            {mandatory?"Bắt buộc":"Tùy chọn"}
                          </Text>
                        </View>
                        {group.options.filter(option=>cartModifierCount(line.selection,option.id)>0
                          ||(expanded&&option.isAvailable)).map(option=>{
                          const count=cartModifierCount(line.selection,option.id);
                          const atMax=groupCount>=group.maxSelect;
                          const wouldSwap=group.maxSelect===1&&atMax&&count===0;
                          return <View key={option.id} style={styles.cartToppingRow}>
                            {safeProductImageUrl(option.imageKey)
                              ?<Image source={{uri:safeProductImageUrl(option.imageKey)!}}
                                style={styles.cartToppingImage}/>
                              :<View style={styles.cartToppingPlaceholder}/>}
                            <View style={styles.toppingCopy}>
                              <Text style={styles.cartToppingName} numberOfLines={2}>
                                {option.name}</Text>
                              <Text style={styles.muted}>
                                {mandatory
                                  ? "Áp dụng cho "+line.quantity+" phần · "+vnd(option.priceDeltaVnd)+" / phần"
                                  : vnd(option.priceDeltaVnd)+" × "+count+" = "+
                                    vnd(option.priceDeltaVnd*count)}
                              </Text>
                            </View>
                            {!mandatory&&<View style={styles.quantityStepper}>
                              <Pressable style={styles.step} accessibilityRole="button"
                                accessibilityLabel={"Bớt topping "+option.name}
                                disabled={!product||!product.isAvailable||count===0||groupCount<=group.minSelect}
                                onPress={()=>changeCartTopping(line,group,option.id,-1)}>
                                <Text style={styles.stepText}>−</Text>
                              </Pressable>
                              <Text style={styles.qtyText}>{count}</Text>
                              <Pressable style={styles.step} accessibilityRole="button"
                                accessibilityLabel={"Thêm topping "+option.name}
                                disabled={!product||!product.isAvailable||!option.isAvailable
                                  ||(!wouldSwap&&atMax)
                                  ||(line.selection.modifierIds.length>=30&&!wouldSwap)}
                                onPress={()=>changeCartTopping(line,group,option.id,1)}>
                                <Text style={styles.stepText}>+</Text>
                              </Pressable>
                            </View>}
                          </View>;
                        })}
                        {(hasOtherOptions||expanded)&&
                          <Pressable accessibilityRole="button"
                            accessibilityLabel={(expanded?"Thu gọn":"Thêm hoặc đổi")+" topping "+group.name}
                            style={styles.cartToppingManage}
                            onPress={()=>setExpandedCartGroups(old=>expanded
                              ?old.filter(id=>id!==cartGroupKey):[...old,cartGroupKey])}>
                            <Text style={styles.cartToppingManageText}>
                              {expanded?"Thu gọn":mandatory?"Thay đổi "+group.name:"＋ Thêm / đổi topping"}
                            </Text>
                          </Pressable>}
                        {groupCount<group.minSelect&&<Text style={styles.warning}>
                          Cần tối thiểu {group.minSelect} topping để đặt món.
                        </Text>}
                      </View>;
                    })}
                    {costs&&<View style={styles.cartPriceBreakdown}>
                      <View style={styles.cartPriceSplit}>
                        <Text style={styles.muted}>{product?.kind === "COMBO" ? "Combo" : "Món " + (variant?.name??"Mặc định")} × {line.quantity}</Text>
                        <Text style={styles.cartPriceValue}>{vnd(costs.dishTotal)}</Text>
                      </View>
                      {costs.comboTotal>0&&<View style={styles.cartPriceSplit}>
                        <Text style={styles.muted}>Lựa chọn combo</Text>
                        <Text style={styles.cartPriceValue}>{vnd(costs.comboTotal)}</Text>
                      </View>}
                      {costs.requiredTotal>0&&<View style={styles.cartPriceSplit}>
                        <Text style={styles.muted}>Lựa chọn bắt buộc</Text>
                        <Text style={styles.cartPriceValue}>{vnd(costs.requiredTotal)}</Text>
                      </View>}
                      <View style={styles.cartPriceSplit}>
                        <Text style={styles.muted}>Topping đã chọn</Text>
                        <Text style={styles.cartPriceValue}>{vnd(costs.toppingTotal)}</Text>
                      </View>
                      <View style={styles.cartLineFooter}>
                        <Text style={styles.muted}>Thành tiền</Text>
                        <Text style={styles.price}>{vnd(costs.total)}</Text>
                      </View>
                    </View>}
                    {unavailable&&<Text style={styles.warning}>
                      Món hoặc tùy chọn đã thay đổi. Hãy chọn lại trên thực đơn.
                    </Text>}
                  </View>;
                })}
                <Text style={styles.sectionTitle}>Tạm tính (không phải báo giá đặt hàng)</Text>
                <Text style={styles.detailPrice}>{vnd(cart.reduce((sum, line) => {
                  const product = productsById.get(line.selection.productId);
                  if (!product) return sum;
                  return sum + cartPriceParts(product,line.selection.variantId,
                     line.selection.modifierIds,line.selection.comboOptionIds??[],
                     line.quantity).total;
                }, 0))}</Text>
                <Text style={styles.muted}>Chưa gồm phí giao theo km thực tế, giảm giá và kiểm tra tình trạng món.</Text>
                <View style={styles.group}>
                  <Text style={styles.sectionTitle}>Thông tin nhận hàng</Text>
                  <Text style={styles.muted}>{selectedAddressId
                    ? savedAddresses.find(item => item.id === selectedAddressId)?.line1 ?? "Chọn địa chỉ đã lưu"
                    : "Chưa chọn địa chỉ đã lưu trong tài khoản"}</Text>
                  <Button label={hasStoredAddress ? "Sửa địa chỉ giao hàng" : "Thêm địa chỉ giao hàng"}
                    alternate onPress={() => { setAddressReturnTo("cart"); setScreen("address"); }} />
                </View>
                {!principal && <Button label="Đăng nhập để tiếp tục" onPress={() => { setLoginReturnTo("cart"); setScreen("login"); }} />}
                {!!principal && <CheckoutPanel accessToken={accessToken} userId={principal.id}
                  branchId={branchId} branchActive={menu?.isActive ?? false} addressId={selectedAddressId}
                  addressRevision={JSON.stringify(savedAddresses.find(a => a.id === selectedAddressId) ?? null)}
                  addressRegionConfirmed={!!savedAddresses.find(a => a.id === selectedAddressId && validateAdministrativeSelection(a))}
                  cart={cart} onPlaced={orderPlaced} />}
              </>
            )}
          </View>
        );
      case "purchased":
        return <PurchasedProductsScreen accessToken={accessToken}
          onLogin={() => { setLoginReturnTo("account"); setScreen("login"); }}
          onReorder={reorder} />;
      case "account":
        return (
          <View style={styles.accountPage}>
            <View style={styles.accountIdentity}>
              <HotpotNavIcon name="user" active size={38} />
              <View style={styles.accountIdentityText}>
                <Text style={styles.pageTitle}>Tôi</Text>
                <Text style={styles.muted}>{principal ? "Tài khoản khách hàng" : "Chào mừng đến Sichuan Hotpot"}</Text>
              </View>
            </View>
            {principal ? (
              <>
                <View style={styles.accountAddressSection}>
                  <View style={styles.accountGroupHeader}>
                    <Text style={styles.sectionTitle}>Địa chỉ giao hàng</Text>
                    <Pressable accessibilityRole="button" style={styles.accountAdd}
                      onPress={() => openAddressEditor("account")}>
                      <Text style={styles.linkText}>＋ Thêm địa chỉ</Text>
                    </Pressable>
                  </View>
                  {savedAddresses.length > 0 ? savedAddressCards("account", true) :
                    <Text style={styles.addressEmptyText}>Chưa có địa chỉ. Thêm vị trí nhận hàng để đặt món nhanh hơn.</Text>}
                  <Pressable style={styles.addressAllLink} accessibilityRole="button"
                    accessibilityLabel="Xem tất cả địa chỉ đã lưu"
                    onPress={() => { setAddressReturnTo("account"); setScreen("address"); }}>
                    <Text style={styles.addressAllLinkText}>Quản lý địa chỉ{savedAddresses.length > 0 ? " (" + savedAddresses.length + ")" : ""}</Text>
                    <Text style={styles.addressAllLinkArrow}>›</Text>
                  </Pressable>
                </View>
                <View style={styles.accountOrdersSection}>
                  <Text style={styles.sectionTitle}>Đơn hàng & mua lại</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Sản phẩm đã mua"
                    style={({ pressed }) => [styles.accountOrderRow, pressed && styles.addressRowPressed]}
                    onPress={() => setScreen("purchased")}>
                    <View style={styles.addressRowIcon}>
                      <HotpotNavIcon name="favorites" size={20} />
                    </View>
                    <View style={styles.accountOrderCopy}>
                      <Text style={styles.accountOrderTitle}>Sản phẩm đã mua</Text>
                      <Text style={styles.addressCardLine}>Xem món đã giao và mua lại nhanh</Text>
                    </View>
                    <Text style={styles.addressQuickChevron}>›</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Lịch sử và theo dõi đơn hàng"
                    style={({ pressed }) => [styles.accountOrderRow, pressed && styles.addressRowPressed]}
                    onPress={() => setScreen("orders")}>
                    <View style={styles.addressRowIcon}>
                      <HotpotNavIcon name="orders" size={20} />
                    </View>
                    <View style={styles.accountOrderCopy}>
                      <Text style={styles.accountOrderTitle}>Lịch sử & theo dõi đơn</Text>
                      <Text style={styles.addressCardLine}>Xem trạng thái, chi tiết và đặt lại</Text>
                    </View>
                    <Text style={styles.addressQuickChevron}>›</Text>
                  </Pressable>
                </View>
                <View style={styles.accountLogout}>
                  <Pressable accessibilityRole="button" style={({ pressed }) => [
                    styles.logoutButton, pressed && actionDepth.pressed,
                  ]} onPress={() => void signOut()}>
                    <Text style={styles.logoutText}>Đăng xuất</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={styles.accountGroup}>
                <Text style={styles.muted}>Đăng nhập để lưu địa chỉ và xem các món đã mua.</Text>
                <Button label="Đăng nhập / Tạo tài khoản"
                  onPress={() => { setLoginReturnTo("account"); setScreen("login"); }} />
              </View>
            )}
          </View>
        );
      case "address":
        return (
          <View style={styles.addressPage} testID="saved-address-page">
            <Text style={styles.addressPageHint}>
              Chọn địa chỉ nhận hàng đã lưu hoặc thêm vị trí mới.
            </Text>
            <View style={styles.addressQuickActions}>
              {([
                { title: "Thêm Nhà riêng", label: "Nhà", icon: "⌂", note: "" },
                { title: "Thêm Văn phòng", label: "Công ty", icon: "▣", note: "" },
                { title: "Thêm", label: "Khác", icon: "+", note: "Lưu địa chỉ thường dùng" },
              ] as const).map(item => (
                <Pressable key={item.title} accessibilityRole="button"
                  accessibilityLabel={item.title === "Thêm" ? "＋ Thêm địa chỉ mới" : "Thêm địa chỉ " + item.label}
                  style={({ pressed }) => [styles.addressQuickRow,
                    pressed && styles.addressRowPressed]}
                  onPress={() => openAddressEditor(addressReturnTo, item.label)}>
                  <View style={styles.addressQuickIconCircle}>
                    {item.title === "Thêm Nhà riêng"
                      ? <HotpotNavIcon name="home" size={21} />
                      : <Text style={styles.addressQuickIcon}>{item.icon}</Text>}
                  </View>
                  <View style={styles.addressQuickCopy}>
                    <Text style={styles.addressQuickTitle}>{item.title}</Text>
                    {!!item.note && <Text style={styles.addressQuickNote}>{item.note}</Text>}
                  </View>
                  <Text style={styles.addressQuickChevron}>›</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.addressListSection}>
              <View style={styles.addressListHeader}>
                <Text style={styles.addressListHeading}>Địa chỉ đã lưu</Text>
                <Text style={styles.addressListCount}>{principal ? savedAddresses.length + "/10" : "Chưa đăng nhập"}</Text>
              </View>
              {principal && savedAddresses.length > 0 ? savedAddressCards(addressReturnTo) : (
                <View style={styles.addressEmptyState}>
                  <Text style={styles.addressEmptyText}>
                    {principal
                      ? "Chưa có địa chỉ đã lưu. Thêm Nhà riêng, Văn phòng hoặc địa chỉ khác ở phía trên."
                      : "Đăng nhập để lưu nhiều địa chỉ. Bạn vẫn có thể thêm bản nháp trên thiết bị."}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.addressDeliveryFootnote}>
              Phí giao được tính theo tuyến đường thực tế sau khi chọn địa chỉ.
            </Text>
            {!!addressErrorText && <Notice message={addressErrorText} error />}
          </View>
        );
    }
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <StatusBar barStyle="dark-content" backgroundColor={palette.white} />
        {!authReady ? (
          <View style={styles.sessionLoading}>
            <ActivityIndicator size="large" color={brand} />
            <Text style={styles.muted}>Đang khôi phục phiên đăng nhập…</Text>
          </View>
        ) : authRestoreError ? (
          <View style={styles.sessionLoading}>
            <Notice message={authRestoreError} error />
            <Button label="Thử khôi phục phiên" onPress={() => setAuthRestoreAttempt(n => n + 1)} />
            <Button label="Xem thực đơn" alternate onPress={() => {
              setAuthRestoreError(""); setScreen("home");
            }} />
          </View>
        ) : screen === "login" ? (
          <AuthScreen onAuthenticated={saveLogin} onGuest={() => { setNotice(""); setScreen("home"); }} />
        ) : (
          <View style={styles.shell}>
            {screen === "address" ? (
              <View style={styles.addressPageHeader}>
                <Pressable accessibilityRole="button" accessibilityLabel="Quay lại từ địa chỉ đã lưu"
                  style={styles.addressBackButton} onPress={() => setScreen(addressReturnTo)}>
                  <Text style={styles.addressBackArrow}>←</Text>
                </Pressable>
                <Text style={styles.addressPageTitle}>Địa điểm đã lưu</Text>
              </View>
            ) : screen === "home" ? (
              <View style={styles.homeHeader}>
                <View style={styles.homeHeaderLine}>
                  <Pressable style={styles.deliveryLocation} accessibilityRole="button"
                    onPress={() => { setAddressReturnTo("account"); setScreen("address"); }}>
                    <Text style={styles.deliveryLocationTitle}>Giao đến  ⌄</Text>
                    <Text style={styles.deliveryLocationValue} numberOfLines={1}>
                      {address.line1 ? address.line1 + (displayAdministrativeSelection(address) ? ", " + displayAdministrativeSelection(address) : "") : "Chọn địa chỉ giao hàng"}
                    </Text>
                  </Pressable>
                  <View style={styles.homeHeaderActions}>
                    <Pressable style={styles.headerIconAction} onPress={() => setScreen("orders")}
                      accessibilityRole="button" accessibilityLabel="Thông báo đơn hàng, xem đơn hàng">
                      <HotpotNavIcon name="notifications" active size={27} />
                    </Pressable>
                    <Pressable style={styles.headerIconAction} onPress={() => setScreen("cart")}
                      accessibilityRole="button" accessibilityLabel="Giỏ hàng">
                      <HotpotNavIcon name="cart" active size={27} />
                    </Pressable>
                  </View>
                </View>

              </View>
            ) : (
              <View style={styles.header}>
                <View style={styles.logoBadge}>
                  <Image source={require("./assets/app-icon.png")} style={{ width: 38, height: 38 }}
                    accessibilityLabel="Logo Lẩu Tứ Xuyên" />
                </View>
                <View style={styles.headerText}>
                  <Text style={styles.brandName}>SICHUAN HOTPOT</Text>
                  <Text style={styles.brandSub}>Lẩu Tứ Xuyên & Trà Sữa</Text>
                </View>
                <Pressable style={styles.headerCart} onPress={() => setScreen("cart")}
                  accessibilityRole="button" accessibilityLabel="Giỏ hàng">
                  <HotpotNavIcon name="cart" active size={25} />
                </Pressable>
              </View>
            )}
            <KeyboardAvoidingView style={[styles.body, screen === "address" && styles.addressBody]}
              behavior={Platform.OS === "ios" ? "padding" : undefined}>
              <ScrollView keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}>
                {notice ? <Notice message={notice} /> : null}
                {mainContent()}
              </ScrollView>
            </KeyboardAvoidingView>
            {screen !== "address" && <View style={styles.bottomNavigation}>
              {([
                ["home", "Trang chủ", "home"],
                ["menu", "Thực đơn", "menu"],
                ["orders", "Đơn hàng", "orders"],
                ["account", "Tôi", "user"],
              ] as const).map(([target, label, icon]) => (
                <Pressable key={target} style={styles.navItem}
                  accessibilityRole="tab" accessibilityState={{ selected: screen === target }}
                  accessibilityLabel={label} onPress={() => { setNotice(""); if (target === "orders") setFocusOrderId(null); setScreen(target); }}>
                  <HotpotNavIcon name={icon} active={screen === target} size={23} />
                  <Text style={[styles.navLabel, screen === target && styles.navActive]}>{label}</Text>
                </Pressable>
              ))}
            </View>}
          </View>
        )}
        <HomePromoPopup branchId={branchId} payload={homePopup} active={screen==="home"}/>
        <Modal visible={!!selectedOffer} transparent animationType="fade"
          onRequestClose={()=>setSelectedOffer(null)}>
          <View style={styles.offerModalOverlay}>
            <Pressable accessibilityRole="button" accessibilityLabel="Đóng chi tiết ưu đãi"
              style={StyleSheet.absoluteFill} onPress={()=>setSelectedOffer(null)}/>
            <SafeAreaView edges={["bottom"]} style={styles.offerModalCard}>
              <View style={styles.offerModalHeading}>
                <Text style={styles.offerModalTitle} numberOfLines={2}>{selectedOffer?.title}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Đóng popup ưu đãi"
                  style={styles.offerModalClose} onPress={()=>setSelectedOffer(null)}>
                  <Text style={styles.offerModalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.offerModalScroll}
                contentContainerStyle={styles.offerModalContent} keyboardShouldPersistTaps="handled">
                {selectedOffer&&safeProductImageUrl(selectedOffer.imageKey)&&
                  <Image source={{uri:safeProductImageUrl(selectedOffer.imageKey)!}}
                    resizeMode="cover" style={styles.offerModalPhoto}/>}
                <Text style={styles.offerModalSummary}>{selectedOffer?.summary}</Text>
                <Text style={styles.offerModalBody}>{selectedOffer?.body}</Text>
                {selectedOffer?.endAt&&<Text style={styles.muted}>
                  Kết thúc: {new Date(selectedOffer.endAt).toLocaleString("vi-VN",
                    {timeZone:"Asia/Ho_Chi_Minh"})}
                </Text>}
                <Text style={styles.muted}>Ưu đãi thông tin; không tự thay đổi giá món trong giỏ.</Text>
              </ScrollView>
              <View style={styles.offerModalActions}>
                {selectedOffer?.ctaTarget==="MENU"&&<Button label="Xem thực đơn"
                  onPress={()=>{setSelectedOffer(null);setCategoryId("");setScreen("menu");}}/>}
                <Button label="Đóng" alternate onPress={()=>setSelectedOffer(null)}/>
              </View>
            </SafeAreaView>
          </View>
        </Modal>
        <Modal visible={!!pendingDeleteAddress} transparent animationType="fade"
          onRequestClose={() => { if (!addressSaving) setPendingDeleteAddress(null); }}>
          <View style={styles.deleteModalBackdrop}>
            <View style={styles.deleteModalCard}>
              <Text style={styles.deleteModalTitle}>Xóa địa chỉ đã lưu?</Text>
              <Text style={styles.deleteModalCopy}>
                {pendingDeleteAddress?.label} sẽ bị xóa khỏi tài khoản. Bạn có thể thêm lại sau.
              </Text>
              {!!addressErrorText && <Notice message={addressErrorText} error />}
              <View style={styles.deleteModalActions}>
                <Pressable accessibilityRole="button" accessibilityLabel="Hủy xóa địa chỉ"
                  disabled={addressSaving} style={styles.deleteCancelAction}
                  onPress={() => { setPendingDeleteAddress(null); setAddressErrorText(""); }}>
                  <Text style={styles.deleteCancelText}>Hủy</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Xác nhận xóa địa chỉ"
                  disabled={addressSaving} style={styles.deleteConfirmAction}
                  onPress={() => { if (pendingDeleteAddress) void deleteSavedAddress(pendingDeleteAddress); }}>
                  {addressSaving ? <ActivityIndicator size="small" color="#FFFFFF" /> :
                    <Text style={styles.deleteConfirmText}>Xóa địa chỉ</Text>}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
        <Modal visible={addressModalOpen} transparent animationType="slide"
          onRequestClose={closeAddressEditor}>
          <KeyboardAvoidingView style={styles.addressModalBackdrop}
            behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={styles.addressModalSheet}>
              <View style={styles.addressModalHeader}>
                <Text style={styles.sectionTitle}>{editingAddressId ? "Sửa địa chỉ " : "Thêm địa chỉ "}{address.label}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={editingAddressId ? "Đóng sửa địa chỉ" : "Đóng thêm địa chỉ"}
                  onPress={closeAddressEditor} style={styles.addressModalClose}>
                  <Text style={styles.addressModalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.addressModalBody}>
                <Text style={styles.muted}>Nhập địa chỉ, chọn GPS hoặc kéo ghim đến đúng vị trí nhận hàng.</Text>
            <Field label="Tên gợi nhớ (Nhà, Công ty...)" value={address.label}
              onChangeText={text => setAddress(old => ({ ...old, label: text }))} placeholder="Nhà" />
            <Field label="Số điện thoại" value={address.phone}
              onChangeText={text => { setAddress(old => ({ ...old, phone: text })); }}
              keyboardType="phone-pad" placeholder="09..." />
            <VietnamAdministrativeAreaPicker provinceCode={address.provinceCode ?? null}
              wardCode={address.wardCode ?? null}
              onChange={(provinceCode, wardCode) => {
                setAddress(old => ({ ...old, catalogVersion: ADMIN_CATALOG_VERSION,
                  provinceCode, wardCode })); setAddressErrorText("");
              }} />
            <Field label="Số nhà, tên đường và ghi chú giao" value={address.line1}
              onChangeText={text => { setAddress(old => ({ ...old, line1: text })); }}
              placeholder="Ví dụ: 25 Nguyễn Trãi, số nhà/tầng..." />
            {(() => {
              const gap = address.latitude && address.longitude
                ? approximateWardDistanceKm(address, Number(address.latitude), Number(address.longitude))
                : null;
              return gap !== null && gap > 30
                ? <Text style={styles.muted}>Ghim có vẻ cách xa phường/xã đã chọn. Hãy kiểm tra vị trí trên bản đồ trước khi lưu; GPS không quyết định phí giao.</Text>
                : null;
            })()}
            <AddressPinMap latitude={address.latitude} longitude={address.longitude}
              onChange={(latitude, longitude) => {
                setAddress(old => ({ ...old, latitude, longitude }));
              }} />
            <Button label={addressBusy ? "Đang lấy GPS..." : "Dùng vị trí GPS hiện tại"} alternate
              disabled={addressBusy} onPress={() => void locateMe()} />
            <Text style={styles.muted}>Nếu không cho phép GPS, nhập tọa độ từ ghim bản đồ đã kiểm tra.</Text>
            <Field label="Vĩ độ (latitude)" value={address.latitude}
              onChangeText={text => { setAddress(old => ({ ...old, latitude: text })); }}
              keyboardType="decimal-pad" placeholder="10.0000000" />
            <Field label="Kinh độ (longitude)" value={address.longitude}
              onChangeText={text => { setAddress(old => ({ ...old, longitude: text })); }}
              keyboardType="decimal-pad" placeholder="106.0000000" />
            {!!address.latitude && !!address.longitude && (
              <Button label="Kiểm tra ghim trên bản đồ" alternate onPress={() => {
                const lat = Number(address.latitude), lon = Number(address.longitude);
                if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
                  setAddressErrorText("Tọa độ không hợp lệ.");
                  return;
                }
                void Linking.openURL("https://www.openstreetmap.org/?mlat=" + lat + "&mlon=" + lon + "#map=17/" + lat + "/" + lon);
              }} />
            )}
            {!!addressErrorText && <Notice message={addressErrorText} error />}
            <Button label={addressSaving ? "Đang lưu địa chỉ..." : editingAddressId ? "Cập nhật địa chỉ" : principal ? "Lưu địa chỉ vào tài khoản" : "Lưu bản nháp trên máy"}
              disabled={addressSaving} onPress={() => void saveAddress()} />

                <Button label="Hủy" alternate disabled={addressSaving} onPress={closeAddressEditor} />
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.white },
  sessionLoading: { flex: 1, padding: 24, justifyContent: "center", alignItems: "stretch", gap: 16 },
  shell: { flex: 1, width: "100%", maxWidth: 620, alignSelf: "center", backgroundColor: palette.white, overflow: "hidden" },
  header: { paddingHorizontal: 16, paddingVertical: 11, flexDirection: "row", alignItems: "center", backgroundColor: "#4A0C0A" },
  logoBadge: { width: 44, height: 44, borderRadius:9,backgroundColor:"#FFFFFF",
    alignItems: "center", justifyContent: "center" },
  logoGlyph: { color: "#FFFFFF", fontSize: 19, fontWeight: "800" },
  headerText: { flex: 1, paddingHorizontal: 10 },
  brandName: { fontSize: typeScale.body, fontWeight: "800", color: palette.white, letterSpacing: 0.4 },
  brandSub: { fontSize: typeScale.caption, color: "#F6DDE0" },
  headerCart: { minWidth: 44, minHeight: 44, borderRadius:12,backgroundColor:"#FFFFFF",
    justifyContent: "center", alignItems: "center" },
  headerCartText: { fontSize: typeScale.small, color: brand, fontWeight: "800" },
  body: { flex: 1, minHeight: 0, paddingBottom: 58 },
  addressBody: { paddingBottom: 0 },
  addressPageHeader: { flexDirection: "row", alignItems: "center", minHeight: 58,
    paddingHorizontal: 12, backgroundColor: palette.white,
    borderBottomWidth: 1, borderBottomColor: "#EEF0F3" },
  addressBackButton: { width: 44, height: 48, alignItems: "center", justifyContent: "center" },
  addressBackArrow: { color: palette.text, fontSize: 26, fontWeight: "400" },
  addressPageTitle: { color: palette.text, fontSize: 18, fontWeight: "800", marginLeft: 7 },
  scrollContent: { paddingBottom: 22, backgroundColor: palette.white, flexGrow: 1 },
  loginPage: { backgroundColor: "#FFFFFF", paddingBottom: 24 },
  loginHeroFrame: { width: "100%", height: 160, backgroundColor: palette.red, overflow: "hidden" },
  loginHeroImage: { width: "100%", height: "100%" },
  loginHeroFallback: { width: "100%", height: "100%", backgroundColor: "#822524", alignItems: "center", justifyContent: "center" },
  loginHeroFallbackIcon: { color: "#F9D29C", fontSize: 64 },
  loginHeroFallbackText: { fontWeight: "900", color: "#FFF1D9", fontSize: 23, letterSpacing: 2 },
  loginHeroTint: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(34,12,10,0.32)", justifyContent: "space-between", paddingHorizontal: 22, paddingVertical: 16 },
  loginBack: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 10, borderRadius: 22, backgroundColor: "rgba(30,10,10,0.48)" },
  loginBackText: { color: "#FFF7ED", fontWeight: "700" },
  loginHeroCopy: { gap: 7, paddingBottom: 12 },
  loginEyebrow: { color: "#FFFFFF", letterSpacing: 2, fontSize: 11, fontWeight: "900" },
  loginHeadline: { color: "#FFFDF8", fontSize: typeScale.hero, fontWeight: "900", lineHeight: 28 },
  loginContent: { paddingHorizontal: 24, paddingTop: 25, gap: 11 },
  loginWelcome: { color: "#20252B", fontSize: typeScale.page, lineHeight: 26, fontWeight: "900" },
  loginSupporting: { color: "#667085", fontSize: 13, lineHeight: 21, marginBottom: 7 },
  loginDivider: { flexDirection: "row", gap: 12, alignItems: "center", justifyContent: "center", marginVertical: 8 },
  loginDividerLine: { flex: 1, height: 1, backgroundColor: "#D0D5DD" },
  loginDividerText: { color: "#667085", fontSize: 12 },
  loginFootnote: { color: "#667085", fontSize: 12, lineHeight: 19 },
  loginGuest: { alignSelf: "center", minHeight: 44, paddingVertical: 12, justifyContent: "center" },
  loginGuestText: { color: brand, fontWeight: "700", textAlign: "center", fontSize: 13 },
  section: { paddingHorizontal: 16, paddingTop: 16, gap: 11 },
  accountPage: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 24,
    gap: 18, flexGrow: 1 },
  accountIdentity: { flexDirection: "row", alignItems: "center", gap: 14,
    paddingVertical: 16, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: palette.line },
  accountIdentityText: { flex: 1, gap: 3 },
  accountGroup: { padding: 14, borderRadius: 16, backgroundColor: palette.white,
    borderWidth: 1, borderColor: palette.line, gap: 12 },
  accountAddressSection: { backgroundColor: palette.white, paddingTop: 3, paddingBottom: 5 },
  accountOrdersSection: { backgroundColor: palette.white, paddingTop: 8, paddingBottom: 5 },
  accountOrderRow: { flexDirection: "row", alignItems: "center",
    minHeight: 70, borderBottomWidth: 1, borderBottomColor: "#EEF0F3", paddingHorizontal: 8 },
  accountOrderCopy: { flex: 1, minWidth: 0, paddingVertical: 11, gap: 5 },
  accountOrderTitle: { color: palette.text, fontSize: 14, fontWeight: "700" },
  addressAllLink: { flexDirection: "row", minHeight: 44, alignItems: "center",
    justifyContent: "space-between", paddingLeft: 8, paddingRight: 11 },
  addressAllLinkText: { color: palette.red, fontSize: 13, fontWeight: "700" },
  addressAllLinkArrow: { color: palette.red, fontSize: 22 },
  accountGroupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  accountAdd: { minHeight: 44, justifyContent: "center", paddingHorizontal: 3 },
  accountLogout: { marginTop: "auto", paddingTop: 28, paddingBottom: 12 },
  logoutButton: { borderColor: palette.red, borderWidth: 1, backgroundColor: palette.softRed,
    minHeight: 48, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  logoutText: { color: palette.red, fontSize: typeScale.action, fontWeight: "800" },
  deleteModalBackdrop: { flex: 1, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(17,24,39,0.48)", paddingHorizontal: 20 },
  deleteModalCard: { width: "100%", maxWidth: 410, padding: 19, borderRadius: 18,
    backgroundColor: palette.white, gap: 12 },
  deleteModalTitle: { fontSize: 17, fontWeight: "800", color: palette.text },
  deleteModalCopy: { fontSize: 13, lineHeight: 20, color: palette.muted },
  deleteModalActions: { flexDirection: "row", gap: 10, marginTop: 7 },
  deleteCancelAction: { flex: 1, minHeight: 46, alignItems: "center",
    justifyContent: "center", borderRadius: 11, borderWidth: 1, borderColor: palette.line },
  deleteCancelText: { fontSize: 14, fontWeight: "700", color: palette.text },
  deleteConfirmAction: { flex: 1, minHeight: 46, alignItems: "center",
    justifyContent: "center", borderRadius: 11, backgroundColor: palette.red },
  deleteConfirmText: { fontSize: 14, fontWeight: "800", color: palette.white },
  addressModalBackdrop: { flex: 1, backgroundColor: "rgba(17,24,39,0.45)",
    justifyContent: "center", alignItems: "center", paddingHorizontal: 12, paddingVertical: 20 },
  addressModalSheet: { width: "100%", maxWidth: 540, maxHeight: "94%", backgroundColor: palette.white,
    borderRadius: 20, overflow: "hidden" },
  addressModalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    borderBottomWidth: 1, borderBottomColor: palette.line, paddingHorizontal: 16, paddingVertical: 10 },
  addressModalClose: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "center" },
  addressModalCloseText: { fontSize: 18, color: palette.text },
  addressModalBody: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 30, gap: 12 },
  homePage: { flex: 1, backgroundColor: palette.white },
    homeHeader: { paddingHorizontal: 16, paddingTop: 11, paddingBottom: 10,
    backgroundColor: "#4A0C0A" },
  homeHeaderLine: { flexDirection: "row", alignItems: "center", gap: 12 },
  deliveryLocation: { flex: 1, minHeight: 49, justifyContent: "center" },
  deliveryLocationTitle: { color: palette.white, fontSize: 12, fontWeight: "700" },
  deliveryLocationValue: { color: palette.white, fontSize: 13, fontWeight: "600", marginTop: 4, maxWidth: 280 },
  homeCart: { minWidth: 44, minHeight: 44, justifyContent: "center" },
  homeHeaderActions: { flexDirection: "row", alignItems: "center", gap: 5 },
  headerIconAction: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  homeCartText: { color: palette.white, fontSize: typeScale.body, fontWeight: "800" },
  homeCartInner: { flexDirection: "row", alignItems: "center", gap: 4 },
  cartIconSurface: { backgroundColor: palette.white, borderRadius: 8, padding: 3 },
  headerCartInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  homeHeroRegion: { backgroundColor: "#4A0C0A", paddingBottom: 12 },
  homeBanner: { overflow: "hidden", marginHorizontal: 12,
    borderRadius: 18, backgroundColor: "#6D1710" },
  homeBannerImage: { position: "absolute" },
  homeBannerShade: { flex: 1, justifyContent: "center", paddingHorizontal: 18,
    backgroundColor: "rgba(47, 2, 0, 0.19)", gap: 7 },
  homeBannerTitle: { fontSize: typeScale.hero, lineHeight: 30, fontWeight: "900", fontStyle: "italic",
    color: "#FFF0D4", maxWidth: "80%" },
  homeBannerCaption: { color: "#FFF7E9", fontSize: typeScale.small, fontWeight: "700" },
  homeBannerCta: { alignSelf: "flex-start", backgroundColor: "#FFE8BE",
    borderRadius: 22, minHeight: 33, paddingHorizontal: 15, justifyContent: "center" },
  homeBannerCtaText: { color: "#9E201B", fontSize: typeScale.small, fontWeight: "900" },
  quickMenu: { flexDirection: "row", justifyContent: "space-between",
    paddingHorizontal: 10, paddingTop: 13, paddingBottom: 15, columnGap: 5 },
  quickItem: { position: "relative", flex: 1, minWidth: 0, minHeight: 89, borderRadius: 18,
    alignItems: "center", justifyContent: "center", paddingVertical: 7, gap: 6 },
  quickItemHotpot: { backgroundColor: "#FBE2E1" },
  quickItemNeutral: { backgroundColor: "#F7F6F5" },
  quickCornerBadge: { position: "absolute", top: 0, right: 0,
    backgroundColor: "#C91421", borderRadius: 12, paddingHorizontal: 5, minHeight: 18,
    justifyContent: "center" },
  quickCornerBadgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  quickLabel: { color: "#1F2126", fontSize: 12, fontWeight: "700" },
  homeSection: { paddingTop: 3, paddingBottom: 12, gap: 10 },
  homeSectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 15 },
  homeSectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 },
  homeSectionTitle: { color: "#202020", fontSize: 18, fontWeight: "900" },
  homeSeeAll: { minHeight: 44, justifyContent: "center" },
  featureCarousel: { flexGrow: 0 },
  featureGrid: { flexDirection: "row", gap: 10, paddingHorizontal: 15, paddingBottom: 4 },
  featureCard: { width: 140, borderRadius: 12, paddingBottom: 9, overflow: "hidden",
    backgroundColor: palette.white, borderWidth: 1, borderColor: "#F3F0EE" },
  featureImage: { height: 118, width: "100%", alignItems: "center", justifyContent: "center",
    backgroundColor: "#FAEAEA" },
  featureTitle: { color: "#1F2024", fontWeight: "700", fontSize: 13, minHeight: 39,
    marginHorizontal: 8, marginTop: 8, lineHeight: 18 },
  featureFooter: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 8,
    alignItems: "center", gap: 4, marginTop: 3 },
  featurePrice: { color: "#C8111F", fontWeight: "900", fontSize: 14, flexShrink: 1 },
  featureAddButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center",
    justifyContent: "center", backgroundColor: "#D51123" },
  featurePlus: { color: palette.white, fontWeight: "800", fontSize: 25, lineHeight: 29 },
  homeEmpty: { marginHorizontal: 15, backgroundColor: palette.graySurface, padding: 16,
    borderRadius: 13, gap: 10, alignItems: "stretch" },
  homeOffers: { paddingTop: 8, paddingBottom: 16, gap: 4 },
  homeOfferGrid: { flexDirection: "row", gap: 10, paddingHorizontal: 15 },
  homeOfferImage: { ...StyleSheet.absoluteFillObject },
  homeOfferCardSummary: { fontSize:11,fontWeight:"600",color:"#FFFFFF" },
  homeOfferEmpty: { marginHorizontal:15,minHeight:72,justifyContent:"center",
    backgroundColor:"#F9FAFB",borderRadius:12,padding:12,gap:8 },
  offerModalOverlay: { flex:1,backgroundColor:"rgba(17,24,39,.52)",
    alignItems:"center",justifyContent:"center",paddingHorizontal:14,paddingVertical:30 },
  offerModalCard: {width:"100%",maxWidth:510,maxHeight:"92%",backgroundColor:"#FFFFFF",
    borderRadius:18,overflow:"hidden"},
  offerModalHeading: {flexDirection:"row",alignItems:"center",justifyContent:"space-between",
    gap:10,paddingHorizontal:16,paddingVertical:10,borderBottomWidth:1,borderColor:"#EAECF0"},
  offerModalTitle:{flex:1,fontSize:18,fontWeight:"900",color:"#20252B"},
  offerModalClose:{width:48,height:48,alignItems:"center",justifyContent:"center"},
  offerModalCloseText:{fontSize:21,color:"#667085"},
  offerModalScroll:{minHeight:0,flexShrink:1},
  offerModalContent:{gap:13,padding:16,paddingBottom:25},
  offerModalPhoto:{width:"100%",height:188,borderRadius:11,backgroundColor:"#F3F4F6"},
  offerModalSummary:{fontSize:16,fontWeight:"800",color:"#B3262D",lineHeight:23},
  offerModalBody:{fontSize:14,lineHeight:22,color:"#20252B"},
  offerModalActions:{flexDirection:"row",gap:9,justifyContent:"flex-end",
    padding:13,borderTopWidth:1,borderColor:"#EAECF0"},
  homeOfferCard: { flexGrow: 0, flexShrink: 0, borderRadius: 13, height: 112, overflow: "hidden", backgroundColor: "#6F2318" },
  homeOfferCardShade: { position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(60,0,0,0.64)", paddingHorizontal: 9, paddingVertical: 7 },
  homeOfferCardTitle: { color: "#FFFFFF", fontSize: 13, lineHeight: 17, fontWeight: "800" },
  homeOfferNote: { color: palette.muted, fontSize: 11, marginHorizontal: 15,
    paddingTop: 3 },
  hero: { backgroundColor: brand, borderRadius: 0, minHeight: 190, paddingHorizontal: 21, paddingVertical: 21, justifyContent: "center", gap: 9 },
  heroEyebrow: { color: "#FFFFFF", fontWeight: "800", fontSize: 11, letterSpacing: 1.3 },
  heroTitle: { color: "#FFFFFF", fontWeight: "900", fontSize: typeScale.hero, lineHeight: 28 },
  heroSubtitle: { color: "#FFFFFF", fontSize: 13, lineHeight: 20 },
  heroAction: { marginTop: 8, backgroundColor: "#FFFFFF", minHeight: 44, alignSelf: "flex-start", borderRadius: 10, paddingHorizontal: 16, justifyContent: "center" },
  heroActionText: { color: "#B3262D", fontWeight: "800", fontSize: 13 },
  pageTitle: { fontSize: typeScale.page, fontWeight: "800", color: "#20252B", marginTop: 4 },
  sectionTitle: { color: "#20252B", fontSize: typeScale.section, fontWeight: "800" },
  categoryTitle: { color: "#20252B", fontSize: 15, fontWeight: "800", marginBottom: 7 },
  categoryBlock: { gap: 8, paddingTop: 8 },
  pills: { flexGrow: 0 },
  pill: { paddingHorizontal: 16, minHeight: 44, borderRadius: 24, backgroundColor: "#F2F4F7", justifyContent: "center", marginRight: 8 },
  pillActive: { backgroundColor: brand },
  pillText: { color: "#667085", fontWeight: "700" },
  pillTextActive: { color: "white" },
  branchPill: { borderRadius: 12, borderWidth: 1, borderColor: "#DCC2B2", paddingHorizontal: 12, paddingVertical: 11, marginRight: 8, minHeight: 44 },
  branchActive: { borderColor: brand, backgroundColor: "#FFF0F0" },
  branchText: { color: "#344054", fontSize: 13, fontWeight: "700" },
  productCard: { backgroundColor: "white", minHeight: 98, borderRadius: 16, padding: 10, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#E4E7EC" },
  productImage: { height: 76, width: 76, borderRadius: 12, backgroundColor: "#FFF0F0" },
  productImageLarge: { width: "100%", height: "100%", borderRadius: 16, backgroundColor: "#FFF0F0" },
  iconTile: { backgroundColor: "#FFF0F0", height: 76, width: 76, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  iconTileTea: { backgroundColor: "#FFF0F0" },
  iconGlyph: { fontSize: 30 },
  productInfo: { flex: 1, paddingHorizontal: 12, gap: 3 },
  productTitleRow: { flexDirection:"row",alignItems:"center",gap:6,minWidth:0 },
  comboBadge: { color:"#B3262D",backgroundColor:"#FDE8EA",fontSize:9,fontWeight:"900",
    borderRadius:7,paddingHorizontal:6,paddingVertical:3,overflow:"hidden" },
  productName: { color: "#20252B", fontSize: typeScale.action, fontWeight: "800", lineHeight: 19, flexShrink:1 },
  price: { color: brand, fontSize: typeScale.action, fontWeight: "900" },
  availability: { color: "#667085", fontSize: 12 },
  forward: { color: brand, fontSize: 23 },
  detailHero: { height: 154, backgroundColor: "#FFF0F0", borderRadius: 16, justifyContent: "center", alignItems: "center" },
  detailTitle: { fontSize: typeScale.page, fontWeight: "800", color: "#20252B" },
  detailPrice: { color: brand, fontSize: 19, fontWeight: "900" },
  productContent: { gap: 9, paddingVertical: 4 },
  productDescription: { color: "#475467", fontSize: 13, lineHeight: 19 },
  productInfoToggle: { minHeight: 44, flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", borderTopWidth: 1, borderBottomWidth: 1,
    borderColor: "#EAECF0", paddingVertical: 8 },
  productInfoToggleText: { color: brand, fontSize: 13, fontWeight: "800" },
  productInfoChevron: { color: brand, fontSize: 18, fontWeight: "800" },
  productInfoSection: { gap: 4 },
  productInfoLabel: { color: "#344054", fontSize: 12, fontWeight: "800" },
  productInfoText: { color: "#475467", fontSize: 13, lineHeight: 19 },
  allergenNotice: { gap: 4, borderLeftWidth: 3, borderLeftColor: "#D92D20",
    backgroundColor: "#FFF6F5", paddingHorizontal: 10, paddingVertical: 9, borderRadius: 8 },
  allergenTitle: { color: "#B42318", fontSize: 12, fontWeight: "900" },
  allergenText: { color: "#7A271A", fontSize: 13, lineHeight: 19 },
  allergenSource: { color: "#912018", fontSize: 11, lineHeight: 16 },
  comboSection: { gap:8,marginTop:8,paddingTop:10,borderTopWidth:1,borderTopColor:"#E4E7EC" },
  comboHeading: { flexDirection:"row",alignItems:"center",gap:7 },
  comboFixedRow: { minHeight:54,flexDirection:"row",alignItems:"center",gap:8,
    borderBottomWidth:1,borderBottomColor:"#F0F1F3",paddingVertical:5 },
  comboChoiceRow: { minHeight:62,flexDirection:"row",alignItems:"center",gap:8,
    borderBottomWidth:1,borderBottomColor:"#F0F1F3",paddingVertical:6 },
  comboThumb: { width:42,height:42,borderRadius:9 },
  comboThumbPlaceholder: { width:42,height:42,borderRadius:9,backgroundColor:"#F1F2F4" },
  comboCartGroup: { gap:3,paddingTop:3 },
  group: { marginTop: 8, gap: 9, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#E4E7EC" },
  sizeStrip: { flexDirection:"row",alignItems:"stretch",gap:8,paddingVertical:4,paddingRight:12 },
  sizeTile: { minWidth:106,minHeight:60,alignItems:"center",justifyContent:"center",
    paddingHorizontal:14,paddingVertical:9,borderRadius:12,borderWidth:1,
    borderColor:"#D0D5DD",backgroundColor:"#FFFFFF",gap:3 },
  sizeTileSelected: { borderColor:"#B3262D",backgroundColor:"#FFF2F2",borderWidth:2 },
  sizeLabel: { color:"#20252B",fontSize:13,fontWeight:"800" },
  sizeLabelSelected: { color:"#B3262D" },
  sizePrice: { color:"#667085",fontSize:12,fontWeight:"700" },
  choiceGroupHeading: { flexDirection:"row",alignItems:"center",gap:9,flexWrap:"wrap" },
  choiceRequirement: { color:"#667085",fontSize:11,fontWeight:"700",
    borderRadius:7,paddingHorizontal:7,paddingVertical:3,backgroundColor:"#F3F4F6" },
  choiceRequired: { color:"#B3262D",backgroundColor:"#FFF0F1" },
  choiceWrap: { flexDirection:"row",flexWrap:"wrap",gap:6,justifyContent:"space-between" },
  requiredGroup: { paddingHorizontal:10,paddingVertical:12,borderRadius:14,
    borderWidth:1,borderColor:"#F5D9DB",backgroundColor:"#FFF9F9",marginTop:12 },
  requiredTile: { width:"31.5%",minWidth:0,borderWidth:1,borderColor:"transparent",
    borderRadius:10,backgroundColor:"transparent",overflow:"hidden" },
  requiredTileSelected: { borderColor:"#B3262D",backgroundColor:"#FFECED" },
  requiredTilePick: { minHeight:98,alignItems:"center",justifyContent:"center",
    paddingHorizontal:2,paddingVertical:6,gap:3 },
  requiredImage: { width:36,height:36,borderRadius:7 },
  requiredTileName: { color:"#20252B",fontWeight:"800",fontSize:12,textAlign:"center" },
  tileCheck: { color:"#B3262D",fontSize:17,fontWeight:"800" },
  tileStepper: { flexDirection:"row",alignItems:"center",justifyContent:"space-around",
    borderTopWidth:1,borderTopColor:"#E4E7EC" },
  tileQtyButton: { minWidth:44,minHeight:44,alignItems:"center",justifyContent:"center" },
  toppingRow: { minHeight:62,flexDirection:"row",gap:8,alignItems:"center",
    borderBottomWidth:1,borderBottomColor:"#F0F1F3",paddingVertical:6 },
  toppingImage: { width:42,height:42,borderRadius:9 },
  toppingPlaceholder: { width:42,height:42,borderRadius:9,backgroundColor:"#F1F2F4" },
  toppingCopy: { flex:1,minWidth:0,gap:3 },
  cartLineHeading: { flexDirection:"row",alignItems:"center",gap:7 },
  cartGroup: { gap:5,borderTopWidth:1,borderTopColor:"#EAECF0",paddingTop:9 },
  cartGroupTitle: { fontWeight:"800",fontSize:13,color:"#20252B" },
  cartToppingRow: { minHeight:54,flexDirection:"row",gap:6,alignItems:"center" },
  cartToppingImage: { width:34,height:34,borderRadius:7 },
  cartToppingPlaceholder: { width:34,height:34,borderRadius:7,backgroundColor:"#F2F4F7" },
  cartToppingName: { fontWeight:"700",fontSize:12,color:"#20252B" },
  cartToppingManage: { minHeight:44,alignSelf:"flex-start",paddingHorizontal:6,
    justifyContent:"center" },
  cartToppingManageText: { color:"#B3262D",fontWeight:"800",fontSize:12 },
  cartLineFooter: { flexDirection:"row",alignItems:"center",justifyContent:"space-between",
    gap:10,borderTopWidth:1,borderTopColor:"#EAECF0",paddingTop:9 },
  cartPriceBreakdown: {gap:7,paddingTop:6},
  cartPriceSplit: {flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:8},
  cartPriceValue: {fontSize:13,fontWeight:"800",color:"#20252B"},

  option: { flexDirection: "row", alignItems: "center",gap:10,
    paddingVertical: 10, paddingHorizontal:6, minHeight: 58, borderBottomWidth: 1,
    borderBottomColor: "#E4E7EC" },
  choiceIndicator: { width:28,height:28,minWidth:28,borderWidth:2,borderRadius:7,
    borderColor:"#667085",backgroundColor:"#FFFFFF",alignItems:"center",justifyContent:"center" },
  radioIndicator: { borderRadius:14 },
  choiceIndicatorSelected: { borderColor:"#B3262D",backgroundColor:"#B3262D" },
  choiceIndicatorGlyph: { fontSize:19,color:"#FFFFFF",fontWeight:"800",lineHeight:24 },
  optionUnavailable: { opacity: 0.45 },
  optionPrice: { color: "#B3262D", fontWeight: "700", fontSize: 13,flexShrink:0 },
  addressPage: { paddingBottom: 26, backgroundColor: palette.white },
  addressPageHint: { paddingHorizontal: 18, paddingTop: 15, paddingBottom: 11,
    color: palette.muted, fontSize: 12, lineHeight: 19 },
  addressQuickActions: { backgroundColor: palette.white, paddingHorizontal: 18 },
  addressQuickRow: { minHeight: 67, flexDirection: "row", alignItems: "center",
    gap: 13, borderBottomWidth: 1, borderBottomColor: "#EEF0F3" },
  addressQuickIconCircle: { width: 41, height: 41, borderRadius: 22,
    backgroundColor: "#F5F6F8", alignItems: "center", justifyContent: "center" },
  addressQuickIcon: { color: palette.text, fontSize: 25, fontWeight: "400" },
  addressQuickCopy: { flex: 1, minWidth: 0, gap: 3, paddingVertical: 11 },
  addressQuickTitle: { color: palette.red, fontSize: 15, fontWeight: "700" },
  addressQuickNote: { color: palette.muted, fontSize: 12, lineHeight: 17 },
  addressQuickChevron: { color: "#9AA1AC", fontSize: 22, paddingRight: 4 },
  addressListSection: { marginTop: 16, borderTopWidth: 8, borderTopColor: "#F6F7F9" },
  addressListHeader: { minHeight: 53, flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", paddingHorizontal: 18, gap: 12 },
  addressListHeading: { color: palette.text, fontSize: 15, fontWeight: "800" },
  addressListCount: { color: palette.muted, fontSize: 12 },
  addressEmptyState: { paddingHorizontal: 18, paddingVertical: 16 },
  addressEmptyText: { color: palette.muted, fontSize: 13, lineHeight: 20 },
  addressDeliveryFootnote: { color: palette.muted, fontSize: 12,
    lineHeight: 19, paddingHorizontal: 18, paddingTop: 16 },
  savedAddress: { flexDirection: "row", alignItems: "center",
    paddingVertical: 10, paddingLeft: 12, paddingRight: 12, minHeight: 83,
    backgroundColor: palette.white, borderBottomWidth: 1,
    borderBottomColor: "#EEF0F3", borderLeftWidth: 3, borderLeftColor: "transparent" },
  savedAddressSelected: { borderLeftColor: palette.red, backgroundColor: "#FFF8F8" },
  addressRowIcon: { width: 40, height: 40, marginRight: 9, borderRadius: 22,
    backgroundColor: "#F5F6F8", justifyContent: "center", alignItems: "center" },
  addressCardCopy: { flex: 1, gap: 5, minWidth: 0, justifyContent: "center",
    minHeight: 53, paddingVertical: 6 },
  addressLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  addressCardLabel: { color: palette.text, fontWeight: "700", fontSize: 14, flexShrink: 1 },
  addressCurrentBadge: { color: palette.red, fontSize: 10, fontWeight: "800",
    backgroundColor: "#FCE7E8", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3,
    overflow: "hidden" },
  addressCardLine: { color: "#636C77", fontSize: 12, lineHeight: 18 },
  addressRowActions: { flexDirection: "row", alignItems: "center" },
  addressRowPressed: { opacity: 0.7 },
  addressPinButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  addressPinGlyph: { fontSize: 25, color: palette.red },
  addressSmallButton: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  addressDeleteGlyph: { fontSize: 12, fontWeight: "700", color: "#9B5A5E" },
  addressEditGlyph: { fontSize: 12, fontWeight: "800", color: palette.red },
  optionText: { flex:1,minWidth:0,color: "#20252B", fontSize: typeScale.action,
    fontWeight: "700" },
  quantityLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13 },
  quantityStepper: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#D0D5DD", borderRadius: 12 },
  step: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 18, color: brand, fontWeight: "800" },
  qtyText: { textAlign: "center", minWidth: 24, fontWeight: "800", color: "#20252B" },
  cartLine: { backgroundColor: "white", borderRadius: 15, borderWidth: 1, borderColor: "#E4E7EC", padding: 12, flexDirection: "column", gap: 9 },
  cartLineDetails: { flex: 1, gap: 6 },
  empty: { gap: 14, alignItems: "stretch", paddingVertical: 20 },
  emptyTitle: { fontSize: typeScale.section, fontWeight: "800", color: "#20252B" },
  muted: { color: "#667085", fontSize: 13, lineHeight: 21 },
  warning: { color: brand, fontSize: 13, fontWeight: "700" },
  notice: { margin: 14, padding: 13, borderRadius: 12, backgroundColor: "#F2F4F7" },
  noticeError: { backgroundColor: "#FEE4E2" },
  noticeText: { color: "#344054", fontSize: 13, lineHeight: 19 },
  field: { gap: 7, paddingTop: 3 },
  fieldLabel: { color: "#344054", fontSize: typeScale.body, fontWeight: "800" },
  input: { backgroundColor: "white", borderWidth: 1, borderColor: "#D0D5DD", borderRadius: 10, minHeight: 44, paddingHorizontal: 14, fontSize: 16, color: "#20252B" },
  button: { backgroundColor: brand, borderRadius: 14, minHeight: 46, justifyContent: "center", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, marginVertical: 2 },
  buttonText: { color: "white", fontSize: typeScale.action, textAlign: "center", fontWeight: "800" },
  buttonOutline: { backgroundColor: "transparent", borderWidth: 1, borderColor: brand },
  buttonOutlineText: { color: brand },
  buttonDisabled: { opacity: 0.45 },
  pressed: { opacity: 0.92 },
  segmentRow: { flexDirection: "row", backgroundColor: "#FFF0F0", borderRadius: 14, padding: 4 },
  segment: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 44, borderRadius: 11 },
  segmentActive: { backgroundColor: "white" },
  segmentText: { color: brand, fontSize: typeScale.body, fontWeight: "800" },
  smallAction: { alignSelf: "flex-end", paddingVertical: 9, minHeight: 44, justifyContent: "center" },
  linkText: { color: brand, fontSize: 13, fontWeight: "700" },
  orText: { textAlign: "center", paddingVertical: 8 },
  bottomNavigation: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 5, borderTopWidth: 1, borderTopColor: "#E4E7EC", backgroundColor: "white", flexDirection: "row", justifyContent: "space-around", minHeight: 58 },
  navItem: { flex: 1, minHeight: 58, alignItems: "center", justifyContent: "center", gap: 2 },
  navGlyph: { fontSize: 20, color: "#98A2B3" },
  navLabel: { color: "#98A2B3", fontSize: typeScale.caption, fontWeight: "800" },
  navActive: { color: brand },
  loader: { marginTop: 30 },
});

export default CustomerApp;
