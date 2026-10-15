# Bộ mã địa giới hành chính Việt Nam
- Bản dữ liệu cố định: `vn-2026-09-08`. Nguồn cộng đồng [Open Admin Data](https://github.com/open-admin-data/vietnam-administrative-divisions) CC-BY-4.0, cập nhật ngày 2026-09-08, đối chiếu [Quyết định 19/2025/QĐ-TTg](https://baochinhphu.vn/bang-danh-muc-va-ma-so-cua-34-tinh-thanh-moi-3321-don-vi-hanh-chinh-cap-xa-moi-102250704153652947.htm).
- Gồm 34 tỉnh/thành, 3321 phường/xã/đặc khu, các mã là chuỗi giữ nguyên số 0 bên trái. Không có tầng quận/huyện hành chính sau 2025; nhóm "Quận 1 cũ" là vùng kinh doanh tùy chọn.
- Bundled trong Customer Expo, Admin Expo và backend; không tải từ bên thứ ba ở runtime. Khi nguồn cập nhật phải nâng `ADMIN_CATALOG_VERSION`, kiểm tra mã, migration/policy tương thích và QA.
- GPS/pin OSM chỉ dùng tìm đường, không suy vùng giao hay ghi đè mã đã chọn.
