import React, { useEffect, useState } from "react";
import { File } from "expo-file-system";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { request } from "./api";
import { StatusSwitch } from "./StatusSwitch";
import { Action, Notice } from "./ui";
import { c } from "./theme";

interface ChatbotConfig {
  enabled: boolean;
  zaloEnabled: boolean;
  zaloPhone: string;
  displayName: string;
  welcomeMessage: string;
  projectId: string | null;
  credentialsConfigured: boolean;
  agentResourceName: string | null;
  agentDisplayName: string | null;
  agentLocation: string | null;
  defaultLanguageCode: string | null;
  environmentResourceName: string | null;
  environmentDisplayName: string | null;
  revision: number;
}
interface AgentItem {
  name: string;
  displayName: string;
  location: string;
  defaultLanguageCode: string;
}
interface EnvironmentItem { name: string; displayName: string; }
interface UploadResponse { config: ChatbotConfig; agents: AgentItem[]; }

async function pickJson(): Promise<{ name: string; text: string } | null> {
  if (Platform.OS === "web") {
    return new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        void file.text().then(text => resolve({ name: file.name, text })).catch(() => resolve(null));
      };
      input.click();
    });
  }
  const picked = await File.pickFileAsync(undefined, "application/json");
  const file = Array.isArray(picked) ? picked[0] : picked;
  if (!file) return null;
  return { name: file.name || "service-account.json", text: await file.text() };
}

export function ChatbotPanel({ token, branchId, onDirtyChange }: {
  token: string;
  branchId: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const root = "/admin/branches/" + encodeURIComponent(branchId) + "/chatbot";
  const [config, setConfig] = useState<ChatbotConfig | null>(null);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [environments, setEnvironments] = useState<EnvironmentItem[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [selectedEnvironment, setSelectedEnvironment] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [zaloEnabled, setZaloEnabled] = useState(true);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const applyConfig = (next: ChatbotConfig) => {
    setConfig(next);
    setEnabled(next.enabled);
    setZaloEnabled(next.zaloEnabled);
    setSelectedAgent(next.agentResourceName ?? "");
    setSelectedEnvironment(next.environmentResourceName ?? "");
  };
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    request<ChatbotConfig>(root, token).then(next => {
      if (!live) return;
      applyConfig(next);
      setDirty(false);
      setError("");
    }).catch(err => {
      if (live) setError(err instanceof Error ? err.message : "Không tải được cấu hình chatbot.");
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; onDirtyChange?.(false); };
  }, [branchId, root, token, onDirtyChange]);

  const run = async (job: () => Promise<void>, success?: string) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await job(); if (success) setNotice(success); }
    catch (err) { setError(err instanceof Error ? err.message : "Thao tác chatbot thất bại."); }
    finally { setBusy(false); }
  };

  const uploadJson = () => {
    void (async () => {
      const picked = await pickJson();
      if (!picked) return;
      if (picked.text.length > 32768) {
        setError("Service Account JSON quá lớn. Chỉ chọn file JSON credential gốc của Google.");
        return;
      }
      await run(async () => {
        const result = await request<UploadResponse>(root + "/credentials", token, "PUT", {
          serviceAccountJson: picked.text,
        });
        applyConfig(result.config);
        setAgents(result.agents);
        setEnvironments([]);
        setFileName(picked.name);
        setDirty(false);
      }, "Đã xác thực JSON và tải danh sách Agent từ Google Cloud.");
    })().catch(err => setError(err instanceof Error ? err.message : "Không đọc được file JSON."));
  };

  const loadAgents = () => void run(async () => {
    const result = await request<{ agents: AgentItem[] }>(root + "/agents", token, "POST");
    setAgents(result.agents);
  }, "Đã tải lại danh sách Agent từ project Google.");

  const chooseAgent = (agent: AgentItem) => void run(async () => {
    setSelectedAgent(agent.name);
    setSelectedEnvironment("");
    setEnvironments([]);
    setDirty(true);
    const result = await request<{ environments: EnvironmentItem[] }>(
      root + "/environments", token, "POST", { agentResourceName: agent.name },
    );
    setEnvironments(result.environments);
  });

  const save = () => void run(async () => {
    if (!config) return;
    if (enabled && !selectedAgent) throw new Error("Chọn một Agent trước khi bật chatbot.");
    const next = await request<ChatbotConfig>(root + "/config", token, "PUT", {
      revision: config.revision,
      enabled,
      zaloEnabled,
      agentResourceName: selectedAgent,
      environmentResourceName: selectedEnvironment,
    });
    applyConfig(next);
    setDirty(false);
  }, "Đã lưu cấu hình chatbot.");

  if (loading) return <Text style={s.hint}>Đang tải cấu hình Chatbot AI…</Text>;

  return <View style={s.page}>
    {!!error && <Notice text={error} error />}
    {!!notice && <Notice text={notice} />}

    <View style={s.section}>
      <Text style={s.title}>Google Dialogflow CX</Text>
      <Text style={s.hint}>JSON Service Account chỉ gửi tới API qua HTTPS và được mã hóa trước khi lưu. Private key không được trả lại ứng dụng.</Text>
      <View style={s.credentialCard}>
        <View style={s.copy}>
          <Text style={s.name}>{config?.credentialsConfigured ? "Đã kết nối Google Cloud" : "Chưa kết nối Google Cloud"}</Text>
          <Text style={s.hint} numberOfLines={2}>
            {config?.projectId ? "Project: " + config.projectId : "Chọn file Service Account JSON của project chứa Dialogflow CX."}
          </Text>
          {!!fileName && <Text style={s.fileName} numberOfLines={1}>File vừa tải: {fileName}</Text>}
        </View>
        <View style={s.dotWrap}><View style={[s.statusDot, config?.credentialsConfigured && s.statusDotOn]} /></View>
      </View>
      <Action label={busy ? "Đang xử lý…" : "Chọn file JSON Google"} onPress={uploadJson} disabled={busy} />
    </View>

    <View style={s.section}>
      <View style={s.row}>
        <View style={s.copy}>
          <Text style={s.title}>Agent trong project</Text>
          <Text style={s.hint}>Không nhập ID thủ công. Bấm tải để đọc Agent thật từ Google.</Text>
        </View>
        <Action secondary label={busy ? "Đang tải…" : "Tải Agent"} onPress={loadAgents}
          disabled={busy || !config?.credentialsConfigured} />
      </View>
      {agents.length === 0
        ? <Text style={s.empty}>{config?.credentialsConfigured ? "Chưa tải danh sách hoặc project chưa có Agent." : "Tải JSON trước để lấy Agent."}</Text>
        : <View style={s.list}>
          {agents.map(agent => <Pressable key={agent.name} accessibilityRole="radio"
            accessibilityState={{ selected: selectedAgent === agent.name }}
            onPress={() => chooseAgent(agent)}
            style={({ pressed }) => [s.option, selectedAgent === agent.name && s.optionActive, pressed && s.pressed]}>
            <View style={s.copy}>
              <Text style={[s.optionTitle, selectedAgent === agent.name && s.optionTitleActive]}>{agent.displayName}</Text>
              <Text style={s.hint}>{agent.location} · {agent.defaultLanguageCode}</Text>
            </View>
            <View style={[s.radio, selectedAgent === agent.name && s.radioActive]} />
          </Pressable>)}
        </View>}
      {config?.agentDisplayName && agents.length === 0 &&
        <Notice text={"Agent đang lưu: " + config.agentDisplayName + (config.agentLocation ? " · " + config.agentLocation : "")} />}
    </View>

    {!!selectedAgent && <View style={s.section}>
      <Text style={s.title}>Environment</Text>
      <Text style={s.hint}>Draft dùng bản đang chỉnh trong Dialogflow. Có thể chọn environment đã publish nếu project có.</Text>
      <Pressable accessibilityRole="radio" accessibilityState={{ selected: !selectedEnvironment }}
        onPress={() => { setSelectedEnvironment(""); setDirty(true); }}
        style={[s.option, !selectedEnvironment && s.optionActive]}>
        <View style={s.copy}><Text style={[s.optionTitle, !selectedEnvironment && s.optionTitleActive]}>Draft (mặc định)</Text>
          <Text style={s.hint}>Agent bản nháp hiện tại</Text></View>
        <View style={[s.radio, !selectedEnvironment && s.radioActive]} />
      </Pressable>
      {environments.map(env => <Pressable key={env.name} accessibilityRole="radio"
        accessibilityState={{ selected: selectedEnvironment === env.name }}
        onPress={() => { setSelectedEnvironment(env.name); setDirty(true); }}
        style={[s.option, selectedEnvironment === env.name && s.optionActive]}>
        <View style={s.copy}><Text style={[s.optionTitle, selectedEnvironment === env.name && s.optionTitleActive]}>{env.displayName}</Text>
          <Text style={s.hint}>Environment đã publish</Text></View>
        <View style={[s.radio, selectedEnvironment === env.name && s.radioActive]} />
      </Pressable>)}
      {config?.environmentDisplayName && environments.length === 0 && !!config.environmentResourceName &&
        <Text style={s.hint}>Đang lưu: {config.environmentDisplayName}</Text>}
    </View>}

    <View style={s.section}>
      <View style={s.switchRow}>
        <View style={s.copy}><Text style={s.name}>Bật Chatbot AI</Text>
          <Text style={s.hint}>{selectedAgent ? "Khách sẽ chat với Agent đã chọn." : "Cần chọn Agent trước khi bật."}</Text></View>
        <StatusSwitch label="Bật Chatbot AI" value={enabled} busy={busy}
          disabled={!selectedAgent || !config?.credentialsConfigured}
          onValueChange={value => { setEnabled(value); setDirty(true); }} />
      </View>
      <View style={s.switchRow}>
        <View style={s.copy}><Text style={s.name}>Hiện Zalo hỗ trợ</Text>
          <Text style={s.hint}>Icon Zalo nằm ở góc phải trên header đỏ · {config?.zaloPhone ?? "0902964685"}</Text></View>
        <StatusSwitch label="Hiện Zalo hỗ trợ" value={zaloEnabled} busy={busy}
          onValueChange={value => { setZaloEnabled(value); setDirty(true); }} />
      </View>
      <Action label={busy ? "Đang lưu…" : "Lưu cấu hình Chatbot"} onPress={save}
        disabled={busy || !dirty} />
    </View>
  </View>;
}

const s = StyleSheet.create({
  page: { gap: 14, paddingBottom: 16 },
  section: { gap: 9, paddingBottom: 13, borderBottomWidth: 1, borderColor: c.line },
  title: { fontSize: 14, fontWeight: "800", color: c.ink },
  name: { fontSize: 13, fontWeight: "700", color: c.ink },
  hint: { fontSize: 12, lineHeight: 18, color: c.secondary },
  fileName: { fontSize: 11, color: c.green, fontWeight: "700" },
  credentialCard: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1,
    borderColor: c.line, borderRadius: 12, padding: 11, backgroundColor: c.pale },
  row: { flexDirection: "row", alignItems: "center", gap: 9 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12,
    minHeight: 58 },
  copy: { flex: 1, gap: 2, minWidth: 0 },
  dotWrap: { width: 28, alignItems: "center" },
  statusDot: { width: 11, height: 11, borderRadius: 8, backgroundColor: "#98A2B3" },
  statusDotOn: { backgroundColor: c.green },
  list: { gap: 7 },
  option: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderColor: c.line, borderRadius: 11, paddingHorizontal: 11,
    paddingVertical: 8, backgroundColor: c.white },
  optionActive: { borderColor: c.red, backgroundColor: c.soft },
  optionTitle: { fontSize: 13, fontWeight: "700", color: c.ink },
  optionTitleActive: { color: c.red },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#98A2B3",
    backgroundColor: c.white },
  radioActive: { borderWidth: 5, borderColor: c.red },
  empty: { fontSize: 12, lineHeight: 18, color: c.secondary, textAlign: "center",
    paddingVertical: 9 },
  pressed: { opacity: 0.75 },
});
