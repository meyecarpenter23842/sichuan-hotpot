/**
 * Sichuan Hotpot FCM gateway (no service-account JSON / no Cloud Run).
 * Deploy as Apps Script Web app: Execute as Me, access Anyone.
 * Required Script property: HOTPOT_RELAY_SECRET_HEX = 64 hex chars.
 * HMAC + TTL + nonce prevents unauthorized/replayed submissions.
 * NEVER log tokens, request bodies or ScriptApp OAuth credentials.
 */
var HOTPOT_PROJECT = "project-0fc02e8a-d32e-4ea9-884";
var HOTPOT_FCM_URL = "https://fcm.googleapis.com/v1/projects/" + HOTPOT_PROJECT + "/messages:send";

function hotpotReply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function hotpotHexBytes_(hex) {
  var output = [];
  for (var i = 0; i < hex.length; i += 2) {
    var b = parseInt(hex.substring(i, i + 2), 16);
    output.push(b > 127 ? b - 256 : b);
  }
  return output;
}

function hotpotValidMessage_(message) {
  return message && typeof message === "object"
    && typeof message.token === "string"
    && message.token.length >= 16 && message.token.length <= 4096
    && message.notification
    && typeof message.notification.title === "string"
    && message.notification.title.length <= 200
    && typeof message.notification.body === "string"
    && message.notification.body.length <= 500
    && message.data && ["TEST", "NEW_ORDER", "ORDER_CONFIRMED", "ORDER_STATUS"]
      .indexOf(message.data.kind) !== -1
    && message.android && message.android.priority === "HIGH"
    && message.android.notification
    && ["new-orders-v3", "customer-orders-v1"]
      .indexOf(message.android.notification.channel_id) !== -1;
}

function doPost(e) {
  try {
    var secret = PropertiesService.getScriptProperties().getProperty("HOTPOT_RELAY_SECRET_HEX");
    if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) {
      return hotpotReply_({ ok: false, code: "NOT_CONFIGURED" });
    }
    var raw = e && e.postData && e.postData.contents;
    if (typeof raw !== "string" || raw.length > 20000) {
      return hotpotReply_({ ok: false, code: "INVALID_REQUEST" });
    }
    var envelope = JSON.parse(raw);
    if (typeof envelope.payload !== "string" || !/^[a-zA-Z0-9_-]{20,15000}$/.test(envelope.payload)
      || typeof envelope.signature !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(envelope.signature)) {
      return hotpotReply_({ ok: false, code: "INVALID_REQUEST" });
    }
    var signatureBytes = Utilities.computeHmacSha256Signature(
      Utilities.newBlob(envelope.payload).getBytes(), hotpotHexBytes_(secret));
    var expected = Utilities.base64EncodeWebSafe(signatureBytes).replace(/=+$/, "");
    var different = 0;
    for (var k = 0; k < expected.length; k++) {
      different |= expected.charCodeAt(k) ^ envelope.signature.charCodeAt(k);
    }
    if (different !== 0) {
      return hotpotReply_({ ok: false, code: "INVALID_SIGNATURE" });
    }

    var decoded = Utilities.newBlob(Utilities.base64DecodeWebSafe(envelope.payload))
      .getDataAsString("UTF-8");
    var signed = JSON.parse(decoded);
    if (!Number.isSafeInteger(signed.ts) || Math.abs(Date.now() - signed.ts) > 60000
      || typeof signed.nonce !== "string"
      || !/^[0-9a-f-]{36}$/.test(signed.nonce)
      || !hotpotValidMessage_(signed.message)) {
      return hotpotReply_({ ok: false, code: "INVALID_PAYLOAD" });
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(2000)) return hotpotReply_({ ok: false, code: "BUSY" });
    try {
      var cache = CacheService.getScriptCache();
      if (cache.get("nonce:" + signed.nonce)) {
        return hotpotReply_({ ok: false, code: "REPLAYED" });
      }
      cache.put("nonce:" + signed.nonce, "1", 120);
    } finally {
      lock.releaseLock();
    }

    var response = UrlFetchApp.fetch(HOTPOT_FCM_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ message: signed.message }),
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() === 200) return hotpotReply_({ ok: true });
    // Do not print provider response bodies or access tokens.
    var content = JSON.parse(response.getContentText() || "{}");
    if (response.getResponseCode() === 404
      && content && content.error && content.error.status === "NOT_FOUND") {
      return hotpotReply_({ ok: false, code: "TOKEN_EXPIRED" });
    }
    return hotpotReply_({ ok: false, code: "FCM_REJECTED" });
  } catch (_) {
    return hotpotReply_({ ok: false, code: "GATEWAY_ERROR" });
  }
}

function doGet() {
  return hotpotReply_({ ok: false, code: "POST_ONLY" });
}

/**
 * Run once from Apps Script Editor to authorize the Firebase Messaging scope.
 * validate_only means zero notification is delivered to any device.
 * Verify Apps Script execution shows FCM_AUTH_OK.
 */
function hotpotAuthorize() {
  var result = UrlFetchApp.fetch(HOTPOT_FCM_URL, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({
      validate_only: true,
      message: { topic: "hotpot-auth-check",
        notification: { title: "Test", body: "Test" } },
    }),
    muteHttpExceptions: true,
  });
  var resultLabel = result.getResponseCode() === 200
    ? "FCM_AUTH_OK" : "FCM_AUTH_FAILED_HTTP_" + result.getResponseCode();
  Logger.log(resultLabel);
  return resultLabel;
}
