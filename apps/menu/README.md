# Menu QR tại bàn — L05 Issue #247

Expo Web PWA `apps/menu`, mục tiêu `https://menu.bepsi.click`. **Chưa deploy/public trước L09**.

## Luồng nghiệp vụ

1. Admin tạo khu vực/bàn và in QR cố định với URL `https://menu.bepsi.click/?table=<qrHandle>`. Đây là locator công khai ngẫu nhiên, **không phải** mã đăng nhập hay session token.
2. Khách quét QR, app GET `/dining/qr/:handle` để biết tên chi nhánh/khu vực/bàn và `branchId` công khai, rồi GET `/catalog/branches/:branchId` để lấy **giá/ảnh R2/danh mục/size/topping/combo thật**.
3. Nếu bàn đã OPEN, POST `/dining/qr/:handle/grants` trả Dining Guest Grant chỉ thuộc phiên đó, có thời hạn 15 phút. Grant nằm trong `sessionStorage` của riêng tab trình duyệt, **không bao giờ ghi vào URL**, không lưu localStorage, không gửi analytics/console; tab đóng là mất. Renew khi còn hợp lệ bằng `POST /dining/guest/renew`, giữ cùng grant ID và lịch sử ticket riêng của khách. Nếu Safari chặn sessionStorage, session hoạt động trong bộ nhớ đến khi reload.
4. Khách chọn món và gửi POST `/dining/guest/tickets` (authorization header `Dining <credential>`). Backend kiểm quyền, chi nhánh, tồn kho, tùy chọn bắt buộc, định giá nguyên VND. Phiếu có `PENDING_APPROVAL`, không xuất bếp/chưa tính vào bill. Staff duyệt/từ chối từ Retail/Admin.
5. GET `/dining/guest/tickets` chỉ cho thấy phiếu **của grant này** (không lộ khách bàn bên cạnh), GET `/dining/guest/bill` chỉ trả tổng đã duyệt/ticket hợp lệ; không trả thông tin tiền thực thu/nhân viên/chi tiết phiên nhạy cảm.
6. Khách có thể gọi thêm nhiều lần. Mỗi lần gửi dùng idempotency key riêng; nếu mạng mất ở thời điểm chưa rõ kết quả, **đóng băng đầy đủ payload, giỏ và key trong sessionStorage** rồi retry nguyên trạng. Không xóa giỏ/hiển thị thành công khi server chưa ACK. Grant đóng/hết hạn, QR cũ bị đổi hoặc bàn chưa mở thì chặn gửi.

## QA

```bash
npm run lint --workspace @hotpot/menu
npm run typecheck --workspace @hotpot/menu
npm run test --workspace @hotpot/menu
npm run build --workspace @hotpot/menu
```

CI thêm `scripts/qa/l05-menu-browser-qa.mjs` trên **Postgres localhost hotpot_ci dùng một lần**: bàn chưa mở, khách quét, size giá tính trên server, phiếu chờ duyệt, 2 khách độc lập, nhân viên duyệt, gia hạn phiên, tải lại giữ lịch sử, thu hồi QR và responsive 320/360/390/428/768 px. Không tuyên bố kiểm thử Safari thật cho đến L09.

## Phát hành / việc chưa xong

- L06: badge/âm realtime/luồng Bếp sau duyệt và trạng thái chế biến; L07: thanh toán/đóng bàn; L09: bảo mật, Safari/Android thiết bị thật, DNS, CORS và release gate.
- Sau khi đóng tab hoặc hết hạn mà không gia hạn, guest grant cũ không thể hồi sinh; khách phải quét lại và nhờ nhân viên kiểm tra phiếu cũ. Giới hạn này giữ cô lập quyền xem giữa khách khác nhau.
- Không triển khai production/migration tự động khi merge L05.
