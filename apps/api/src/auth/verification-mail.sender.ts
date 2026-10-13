import { Injectable, ServiceUnavailableException } from "@nestjs/common";

/** Neon stores challenges; transactional email is sent through a verified Resend sender. */
@Injectable()
export class VerificationMailSender {
  async sendCode(to: string, code: string, purpose: "REGISTER" | "RESET_PASSWORD"): Promise<void> {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.HOTPOT_MAIL_FROM;
    if (!key || !from || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) {
      throw new ServiceUnavailableException("Dịch vụ gửi email chưa được cấu hình.");
    }
    const endpoint = process.env.NODE_ENV === "test" && process.env.RESEND_TEST_API_URL
      ? process.env.RESEND_TEST_API_URL : "https://api.resend.com/emails";
    if (endpoint !== "https://api.resend.com/emails" &&
        !(process.env.NODE_ENV === "test" && endpoint === "http://127.0.0.1:3333/emails")) {
      throw new ServiceUnavailableException("Cấu hình gửi email không hợp lệ.");
    }
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({
          from, to: [to],
          subject: purpose === "REGISTER" ? "Mã xác minh Sichuan Hotpot" : "Mã đặt lại mật khẩu Sichuan Hotpot",
          text: "Mã xác minh của bạn: " + code + "\nMã hết hạn sau 10 phút. Không chia sẻ mã này.",
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("email-provider-failed");
    } catch {
      throw new ServiceUnavailableException("Không gửi được email xác minh. Vui lòng thử lại.");
    }
  }
}
