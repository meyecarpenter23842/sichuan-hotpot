# #128 — Phí vùng (chưa phát hành production)

- Migration `20261015090000_p0_zone_delivery_pricing` chỉ **thêm** cột, bảng, enum và constraint. Không backfill mơ hồ địa chỉ cũ; `provinceCode/wardCode/catalogVersion` để NULL cho đến khi người dùng chọn lại từ danh mục versioned (#129).
- `DeliveryPolicyVersion.pricingMode` mặc định `DISTANCE` với bản ghi lịch sử. Khi OWNER tạo chính sách `ZONE`, các phiên bản sau không cho trở lại DISTANCE.
- Rate là bất biến theo version, mỗi chi nhánh có nhiều vùng. Ward ưu tiên hơn province fallback; duplicate ở cùng cấp phải bị từ chối. Không match text/GPS. Checkout sử dụng addressId thuộc tài khoản, đọc lại vùng, fee và chính sách **bên trong transaction SERIALIZABLE**. Order lưu snapshot vùng/phí cùng thông tin định vị để shipper giao.
- Không đổi phí các đơn cũ; `Order.roadDistanceMeters` null trên đơn ZONE. Lệnh quote/checkout lỗi với địa chỉ chưa chuẩn hóa, vùng không phục vụ hoặc không có phí. Không tự điền số mét/0đ.
- **Rollback**: trước khi áp production, bắt buộc backup/restore test từ bản sao database riêng. Chỉ rollback schema nếu chưa có đơn/chính sách ZONE: chạy migrate rollback trên database **disposable** để kiểm chứng, hoặc restore toàn bộ backup trước migration. Không chạy DROP trực tiếp trên production có đơn ZONE; giữ snapshot để đối soát.
- **Release gate**: PR merge không deploy; đợi #129 làm dropdown danh mục địa lý và bản đồ địa chỉ, xác thực mã phiên bản trên server; cần E2E PWA/Android trước production. Tuyệt đối không dùng migration production cho đến khi có cho phép và backup được xác nhận.
