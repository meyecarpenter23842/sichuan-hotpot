import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest } from "../api";
import { palette, typeScale } from "../theme";

interface PublicChatbotConfig {
  enabled: boolean;
  configured: boolean;
  zaloEnabled: boolean;
  zaloPhone: string;
  displayName: string;
  welcomeMessage: string;
}
interface ChatMessage { id: number; role: "user" | "assistant"; text: string; }

function newSessionId(): string {
  return "cx-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}

export function ChatbotWidget({ branchId, active }: { branchId: string; active: boolean }) {
  const { width, height } = useWindowDimensions();
  const [config, setConfig] = useState<PublicChatbotConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const sessionId = useRef(newSessionId());
  const messageSeq = useRef(0);
  const scroll = useRef<ScrollView | null>(null);

  useEffect(() => {
    sessionId.current = newSessionId();
    messageSeq.current = 0;
    setMessages([]);
    setInput("");
    setError("");
    setOpen(false);
    if (!active || !branchId) { setConfig(null); return; }
    let live = true;
    apiRequest<PublicChatbotConfig>("/catalog/branches/" + encodeURIComponent(branchId) + "/chatbot")
      .then(value => { if (live) setConfig(value); })
      .catch(() => { if (live) setConfig(null); });
    return () => { live = false; };
  }, [active, branchId]);

  const openZalo = () => {
    if (!config?.zaloEnabled) return;
    void Linking.openURL("https://zalo.me/" + config.zaloPhone).catch(() => {
      setError("Không mở được Zalo trên thiết bị này.");
    });
  };

  const send = () => {
    const text = input.trim();
    if (!text || sending || !config?.enabled) return;
    const userMessage: ChatMessage = { id: ++messageSeq.current, role: "user", text };
    setMessages(old => [...old, userMessage]);
    setInput("");
    setError("");
    setSending(true);
    void apiRequest<{ reply: string }>(
      "/catalog/branches/" + encodeURIComponent(branchId) + "/chatbot/message",
      { method: "POST", body: { sessionId: sessionId.current, text } },
    ).then(result => {
      setMessages(old => [...old, {
        id: ++messageSeq.current, role: "assistant", text: result.reply,
      }]);
    }).catch(err => {
      setError(err instanceof Error ? err.message : "Chatbot chưa phản hồi. Vui lòng thử lại.");
    }).finally(() => setSending(false));
  };

  if (!active || !config || (!config.enabled && !config.zaloEnabled)) return null;
  const panelWidth = Math.min(390, Math.max(290, width - 20));
  const panelHeight = Math.min(580, Math.max(320, height - 118));

  return <>
    <Pressable testID="chatbot-fab" accessibilityRole="button" accessibilityLabel="Mở hỗ trợ trực tuyến"
      onPress={() => { setOpen(true); setError(""); }}
      style={({ pressed }) => [s.fab, pressed && s.pressed]}>
      <MaterialCommunityIcons name="message-text-outline" size={27} color="#FFFFFF" />
    </Pressable>
    <Modal visible={open} transparent animationType="fade" statusBarTranslucent
      onRequestClose={() => setOpen(false)}>
      <View style={s.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Đóng khung hỗ trợ"
          style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={[s.panelWrap, { width: panelWidth }]}>
          <SafeAreaView edges={["bottom"]} style={[s.card, { height: panelHeight }]}>
            <View style={s.header}>
              <View style={s.headerCopy}>
                <View style={s.botMark}>
                  <MaterialCommunityIcons name="robot-outline" size={20} color={palette.red} />
                </View>
                <View style={s.headerText}>
                  <Text style={s.headerTitle} numberOfLines={1}>{config.displayName}</Text>
                  <Text style={s.headerStatus}>{config.enabled ? "Đang trực tuyến" : "Hỗ trợ qua Zalo"}</Text>
                </View>
              </View>
              <View style={s.headerActions}>
                {config.zaloEnabled ? <Pressable accessibilityRole="link" accessibilityLabel="Mở Zalo hỗ trợ"
                  onPress={openZalo} style={({ pressed }) => [s.zaloButton, pressed && s.headerPressed]}>
                  <Text style={s.zaloMark}>Z</Text>
                </Pressable> : null}
                <Pressable accessibilityRole="button" accessibilityLabel="Đóng chatbot"
                  onPress={() => setOpen(false)} style={({ pressed }) => [s.close, pressed && s.headerPressed]}>
                  <MaterialCommunityIcons name="close" size={22} color="#FFFFFF" />
                </Pressable>
              </View>
            </View>

            <ScrollView ref={scroll} style={s.messages} contentContainerStyle={s.messagesContent}
              keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
              onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
              <View style={[s.bubble, s.botBubble]}>
                <Text style={s.botText}>{config.welcomeMessage}</Text>
              </View>
              {!config.enabled ? <View style={s.offlineNotice}>
                <Text style={s.offlineText}>Chatbot đang tạm nghỉ. Bạn có thể bấm Zalo ở góc trên để được hỗ trợ.</Text>
              </View> : null}
              {messages.map(message => <View key={message.id}
                style={[s.bubble, message.role === "user" ? s.userBubble : s.botBubble]}>
                <Text style={message.role === "user" ? s.userText : s.botText}>{message.text}</Text>
              </View>)}
              {sending ? <View style={[s.bubble, s.botBubble, s.typing]}>
                <ActivityIndicator size="small" color={palette.red} />
                <Text style={s.typingText}>Đang trả lời…</Text>
              </View> : null}
              {!!error ? <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View> : null}
            </ScrollView>

            <View style={s.composer}>
              <TextInput accessibilityLabel="Nhập tin nhắn cho chatbot"
                value={input} onChangeText={setInput} maxLength={500}
                editable={config.enabled && !sending}
                placeholder={config.enabled ? "Nhập câu hỏi…" : "Chatbot đang tạm nghỉ"}
                placeholderTextColor={palette.placeholder}
                style={s.input}
                returnKeyType="send" blurOnSubmit={false}
                onSubmitEditing={send} />
              <Pressable accessibilityRole="button" accessibilityLabel="Gửi tin nhắn"
                disabled={!config.enabled || !input.trim() || sending}
                onPress={send}
                style={({ pressed }) => [s.send,
                  (!config.enabled || !input.trim() || sending) && s.sendDisabled,
                  pressed && s.pressed]}>
                <MaterialCommunityIcons name="send" size={20} color="#FFFFFF" />
              </Pressable>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  </>;
}

const s = StyleSheet.create({
  fab: { position: "absolute", right: 14, bottom: 76, zIndex: 70, width: 54, height: 54,
    borderRadius: 27, backgroundColor: palette.red, alignItems: "center", justifyContent: "center",
    elevation: 8, shadowColor: "#000000", shadowOpacity: 0.22, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 } },
  pressed: { opacity: 0.78 },
  overlay: { flex: 1, alignItems: "flex-end", justifyContent: "flex-end",
    paddingHorizontal: 10, paddingBottom: 70, backgroundColor: "rgba(16,12,12,.20)" },
  panelWrap: { maxWidth: "100%" },
  card: { maxHeight: "100%", borderRadius: 18, overflow: "hidden", backgroundColor: palette.white,
    borderWidth: 1, borderColor: "#D9DDE3", elevation: 14, shadowColor: "#000000",
    shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 7 } },
  header: { minHeight: 62, paddingHorizontal: 12, backgroundColor: palette.red,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  headerCopy: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 9 },
  botMark: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#FFFFFF",
    alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1, minWidth: 0 },
  headerTitle: { color: "#FFFFFF", fontSize: typeScale.action, fontWeight: "800" },
  headerStatus: { color: "#FFE3E4", fontSize: typeScale.caption, marginTop: 2 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  zaloButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#0068FF",
    borderWidth: 2, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  zaloMark: { color: "#FFFFFF", fontSize: 17, lineHeight: 20, fontWeight: "900" },
  close: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  headerPressed: { backgroundColor: "rgba(0,0,0,.14)" },
  messages: { flex: 1, backgroundColor: "#F7F8FA" },
  messagesContent: { padding: 12, gap: 8, flexGrow: 1 },
  bubble: { maxWidth: "84%", borderRadius: 14, paddingHorizontal: 11, paddingVertical: 9 },
  botBubble: { alignSelf: "flex-start", backgroundColor: "#FFFFFF", borderWidth: 1,
    borderColor: palette.line, borderBottomLeftRadius: 5 },
  userBubble: { alignSelf: "flex-end", backgroundColor: palette.red, borderBottomRightRadius: 5 },
  botText: { color: palette.text, fontSize: typeScale.body, lineHeight: 19 },
  userText: { color: "#FFFFFF", fontSize: typeScale.body, lineHeight: 19 },
  offlineNotice: { alignSelf: "stretch", borderRadius: 10, padding: 9, backgroundColor: palette.softRed },
  offlineText: { color: palette.red, fontSize: typeScale.small, lineHeight: 18 },
  typing: { flexDirection: "row", alignItems: "center", gap: 7 },
  typingText: { color: palette.muted, fontSize: typeScale.small },
  errorBox: { alignSelf: "stretch", borderRadius: 10, padding: 9, backgroundColor: "#FFF0F0",
    borderWidth: 1, borderColor: "#F4C8CC" },
  errorText: { color: "#9B1C24", fontSize: typeScale.small, lineHeight: 18 },
  composer: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: palette.line,
    backgroundColor: "#FFFFFF" },
  input: { flex: 1, minHeight: 44, maxHeight: 92, borderWidth: 1, borderColor: "#D0D5DD",
    borderRadius: 22, paddingHorizontal: 14, paddingVertical: 9, color: palette.text,
    backgroundColor: "#FFFFFF", fontSize: 16 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.red,
    alignItems: "center", justifyContent: "center" },
  sendDisabled: { opacity: 0.42 },
});
