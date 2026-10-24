# L04 Retail sơ đồ bàn trực quan — Issue #273

## Phạm vi

Chế độ **Sơ đồ bàn** dành cho Retail Web PWA và Retail Android Native (dùng chung React Native/Expo). Desktop/tablet chọn tab *Sơ đồ bàn*; điện thoại vào *Bàn* rồi chuyển *Danh sách bàn / Sơ đồ bàn*. Chế độ cũ, gọi món, duyệt QR, hóa đơn, chuyển bàn, đóng bàn không đổi.

Mỗi chi nhánh có nhiều **khu vực thật** từ backend (`DiningArea`). Mỗi bàn có vị trí `(floorRow, floorColumn)` tùy chọn; một khu vực có lưới 6 cột × tối đa 20 hàng, scroll ngang trên mobile. Tọa độ gắn với ID bàn, không phụ thuộc thứ tự. Bàn chưa xếp được liệt kê riêng, vẫn mở bàn bằng một chạm. Màu thể hiện *Trống / Đang phục vụ / QR chờ duyệt / Chờ dọn*; bàn vô hiệu hóa giữ trạng thái riêng. Không đoán số bàn hay trạng thái cục bộ.

**Sắp xếp không dùng kéo-thả**: OWNER/MANAGER chọn *Sắp xếp*, chạm bàn (trên lưới hoặc danh sách chưa xếp), chạm ô đích; hoặc *Bỏ vị trí*. Cách này phù hợp touch Android và không cần dependency drag-drop. Nhân viên WAITER/CASHIER chỉ xem/chọn bàn. Server kiểm tra role và chi nhánh cho mọi PATCH; CAS bảo vệ chống ghi đè khi nhiều thiết bị chỉnh sửa; unique DB ngăn hai bàn chung ô.

## Database và deploy an toàn

Migration additive: `20261024020000_dinein_l04_floor_positions` chỉ thêm hai cột nullable, CHECK cặp tọa độ/hạn mức và unique index theo `branchId, areaId, floorRow, floorColumn`. Không chuyển vị trí, xóa bàn, sửa session, QR hoặc hóa đơn cũ. Existing tables vẫn ở **Bàn chưa xếp vị trí** đến khi quản lý sắp xếp.

**Bắt buộc deploy migration production an toàn + API trước khi phát hành Retail PWA/Android sử dụng floor plan.** Chỉ phát hành sau khi chủ quán cho phép, backup + isolated restore đã kiểm chứng; không tự deploy hoặc migrate từ merge. Nếu PWA mới phát hành trước migration thì API GET `/tables` sẽ lỗi vì thiếu cột — tránh triển khai sai thứ tự. Rollback ứng dụng cũ an toàn vì hai cột nullable, không xóa migration production tùy tiện.

## Kiểm thử

CI bắt buộc: Prisma migration disposable PostgreSQL; lint/typecheck/test; Retail Web build; test role OWNER/MANAGER/WAITER/CASHIER/KITCHEN, wrong branch, 409 stale/collision, missing table, bounds, null-clear; Native Android fixture build/emulator (nếu workflow kích hoạt). CI mock/unit không thay thế thiết bị thật.

QA trước khi gọi PASS:
- 320/360/390/428, 768, 1024/1280/1440: không overflow theo chiều dọc; 6 cột giữ nguyên tọa độ; ở mobile vuốt ngang được, không che bottom tab/keyboard.
- Bàn trống, đang phục vụ, QR đang chờ, chờ dọn, tạm khóa; nhiều bàn (20/60/120), bảng trống và khu vực trống.
- OWNER/MANAGER đặt hai bàn ở hai ô khác nhau, đổi vị trí, bỏ xếp. Mở song song hai thiết bị, người thứ hai dùng vị trí cũ phải nhận 409 và tải lại, không mất vị trí của người thứ nhất.
- WAITER/CASHIER không có nút Sắp xếp, backend PATCH trực tiếp trả 403. Sai chi nhánh/ID bàn/area trả 403/404, không rò dữ liệu.
- Chạm bàn ở sơ đồ mở đúng bàn trong màn POS; không mất giỏ draft/phiếu uncertain khi đang chọn bàn khác; gọi món/duyệt QR/thanh toán vẫn backend-authoritative.
- Rớt mạng: sơ đồ cũ vẫn đọc, không ghi vị trí; khi mạng trở lại polling/WebSocket tải dữ liệu mới.
- Safari iPhone và Android thật cần test tương tác chạm/safe-area. Không đánh dấu QA native PASS chỉ dựa vào CI emulator màn login.

**Production deploy / migration: CHƯA THỰC HIỆN.** Local Windows `F:\1_A_Disk_D\hotpot`: không truy cập từ môi trường chat, chưa đồng bộ.
