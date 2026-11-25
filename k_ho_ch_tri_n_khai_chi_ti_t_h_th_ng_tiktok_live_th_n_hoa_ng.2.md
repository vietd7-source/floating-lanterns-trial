# Kế hoạch triển khai chi tiết hệ thống TikTok Live Thả Đèn Hoa Đăng

## 1. Phương án tốt nhất được chọn (No-Bloat, Mượt & Dễ Vận Hành)

Mục tiêu cốt lõi là xây dựng bản **MVP trong 1–2 tuần** chạy ổn định trên **VPS Ubuntu headless** (khung dọc `720x1280 @ 30fps`), ưu tiên độ mượt hình ảnh, tính an toàn/tinh tế của âm thanh và khả năng kiểm soát rủi ro trước khi đầu tư sâu.

### Kiến trúc tách bạch & đồng bộ:
1. **Giao diện HTML5 Canvas 6 tầng (`public/index.html`) + SFX phân tầng nhẹ (`soundEngine`):**
   - Dựng dòng sông đêm, vầng trăng, gợn sóng, đom đóm, Bảng Tri Ân (có huy hiệu Kim Cương cho mốc 500+ xu) và thẻ vinh danh/spotlight.
   - **6 tầng hiệu ứng leo thang rõ rệt theo giá trị Gift:**
     - **Tầng 1 (0 xu · Bình luận):** Đèn giấy vàng trôi chậm kèm vòng sóng nhỏ.
     - **Tầng 2 (1–19 xu · Hoa Sen):** Đèn hoa sen hồng lớn hơn, tỏa ánh sáng ấm và thẻ spotlight.
     - **Tầng 3 (20–99 xu · Đèn Trời):** Đèn Khổng Minh bay lên bầu trời kèm vệt sáng/tia sáng.
     - **Tầng 4 (100–499 xu · Thuyền Hành Trình):** Thuyền lồng đèn trôi ngang đều, chậm rãi (~`1.05px/frame`) với đôi đèn đầu mũi/đuôi thuyền, dùng **sprite quầng sáng vẽ sẵn (`drawImage`)** và giới hạn số hạt/đèn tối đa để tuyệt đối không giật/rung trên khung dọc.
     - **Tầng 5 (500–1.999 xu · Cực Quang Ngân Hà):** Dải cực quang lượn sóng, mưa 10 đèn trời đồng loạt, nhiều đợt pháo hoa, thẻ vinh danh trung tâm và nâng cấp Bảng Tri Ân Kim Cương.
     - **Tầng 6 (2.000+ xu · Rồng Vàng Giáng Thế):** Đổi sắc lễ hội hoàng kim, Rồng ánh sáng vàng bay uốn lượn quanh trăng, mưa đèn/pháo hoa đại lễ, rung nhẹ màn hình có kiểm soát và thẻ vinh danh nổi bật.
   - **SFX phân tầng nhẹ trong HTML:** Web Audio API có bộ lọc `lowpass` dịu tai, `cooldown` chống ồn cho bình luận dồn dập, pháo hoa trầm ở xa, kèm nút bật/tắt và chỉnh âm lượng.
2. **Nhạc nền ambient & TTS tách bạch trên Server/Pipeline:**
   - **Nhạc nền ambient:** Cấu hình riêng nguồn nhạc không lời/thiên nhiên nhẹ chạy vòng lặp liên tục (ưu tiên an toàn bản quyền khi live dài), giữ mức âm lượng thấp (~10–15%) và tự hạ nhỏ (*ducking*) khi có giọng AI đọc lời chúc hoặc hiệu ứng tầng cao.
   - **Giọng đọc `edge-tts` (`vi-VN-HoaiMyNeural`):** Hàng đợi có giới hạn độ dài (`MAX_QUEUE = 6`), **fallback im lặng** nếu lỗi để không đứng luồng.
3. **Backend Node.js (`server.js`) & Quản lý vòng đời Headless:**
   - Kết nối `tiktok-live-connector` (có phân loại lỗi kết nối/signing/quota ngay ở bước đầu).
   - `userWishMap` có **TTL 20 phút** và dọn dẹp định kỳ để tránh rò rỉ RAM hoặc gán nhầm lời chúc cũ.
   - Lọc từ cấm (`banned-words.json`) trước khi thả đèn hoặc đọc TTS.
   - Khóa endpoint mock/test (`127.0.0.1` hoặc tắt khi chạy live thật) và đồng bộ vòng đời `Chromium` + `FFmpeg` để không sinh tiến trình mồ côi hay màn hình đen.

---

## 2. Lộ trình triển khai cho Claude Code (từng bước rõ ràng)

### Giai đoạn 1: Cổng kiểm tra kết nối & Khung nền (`Step 1`)
- Khởi tạo dự án Node.js trên VPS Ubuntu headless (`720x1280 @ 30fps`).
- Cài font tiếng Việt (`fonts-noto`, `fonts-dejavu`) để render chữ không bị lỗi ô vuông trên Linux headless.
- Viết module kiểm tra kết nối `tiktok-live-connector` / dịch vụ signing/quota theo biến môi trường (`.env`), log rõ lỗi kết nối tạm thời vs. lỗi quota/signing để xác nhận trạng thái `go / no-go`.
- Hỗ trợ cờ `ENABLE_MOCK=true` (chỉ mở an toàn ở `127.0.0.1` hoặc có token, tắt khi live thật) để test xuyên suốt khi chưa có phòng live.

### Giai đoạn 2: Core State, Lọc nội dung & Hàng đợi TTS (`Step 2`)
- Hiện thực `userWishMap` với **TTL = 20 phút**, tự động xóa bản ghi hết hạn theo chu kỳ.
- Tạo `banned-words.json` và hàm kiểm duyệt bình luận/lời chúc trước khi đưa vào Canvas hoặc TTS.
- Dựng hàng đợi `edge-tts` (`vi-VN-HoaiMyNeural`) với `MAX_QUEUE = 6`, bỏ qua câu cũ khi ùn ứ và **fallback im lặng** nếu gặp lỗi mạng/API.

### Giai đoạn 3: Giao diện Canvas 6 tầng mượt mà & SFX phân tầng (`Step 3`)
- Dựng giao diện chuẩn dọc `9:16` (`720x1280`) với 6 tầng hiệu ứng theo ngưỡng xu (`0`, `1–19`, `20–99`, `100–499`, `500–1999`, `2000+`).
- Bắt buộc áp dụng tối ưu hiệu năng:
  - Pre-bake các sprite quầng sáng (`goldGlowSprite`, `roseGlowSprite`, `vesselAuraSprite`) vẽ bằng `ctx.drawImage`, tránh tạo `createRadialGradient` mới liên tục trong vòng lặp `requestAnimationFrame`.
  - Tầng 4 thuyền hành trình trôi đều, mượt (~`1.05px/frame`), không dừng bập bềnh gây giật; giới hạn tối đa số lượng hạt sparkle và đèn hiển thị cùng lúc.
- Tích hợp `soundEngine` nhẹ nhàng trong HTML có `lowpass`, `cooldown` bình luận, nút bật/tắt và thanh âm lượng.

### Giai đoạn 4: Nhạc nền ambient, Đồng bộ Chromium + FFmpeg & Chạy thử ca tối (`Step 4`)
- Cấu hình nguồn nhạc nền ambient vòng lặp riêng (âm lượng nhẹ, có cơ chế giảm âm khi đọc TTS/hiệu ứng lớn) và đảm bảo `AudioContext` được kích hoạt/resume đúng khi chạy headless.
- Viết script quản lý vòng đời `Chromium` (headless/virtual render) và `FFmpeg` RTMP (`720x1280 @ 30fps`): khi một tiến trình dừng hoặc lỗi thì dọn dẹp sạch tiến trình con và khởi động lại theo backoff, tránh treo màn hình đen.
- Chạy thử nghiệm 1–2 tuần theo ca cố định buổi tối (ví dụ `21h00–00h30`), không mở rộng thêm tính năng ngoài scope MVP.

---

## 3. Ràng buộc & Tiêu chí đánh giá sau 7–10 ngày

### Ràng buộc kỹ thuật bắt buộc (Không phá vỡ):
- Không thêm thư viện nặng hay tầng microservice/database phức tạp trong giai đoạn MVP.
- Mọi lời chúc/bình luận phải qua bộ lọc từ cấm trước khi hiển thị hoặc phát âm thanh.
- `userWishMap` luôn có TTL 20 phút; hàng đợi TTS luôn có giới hạn `MAX_QUEUE = 6`.
- Không để tiến trình `Chromium` hoặc `FFmpeg` chạy ngầm mồ côi khi restart.

### Tiêu chí đo lường sau 7–10 ngày chạy thử:
1. **Retention / Thời gian giữ chân:** Người xem trung bình ở lại bao lâu và có tương tác thả đèn bằng bình luận không.
2. **Chuyển đổi Gift & Đua tầng:** Có phát sinh Gift tự nhiên qua các mốc (1 xu, tầm trung, cao) hay không.
3. **Độ ổn định & An toàn tài khoản:** Luồng stream có giữ mượt 30fps trong suốt ca tối không, và tài khoản có bị cảnh báo/giảm phân phối/tắt Gift hay không — làm căn cứ quyết định **tiếp tục tối ưu**, **điều chỉnh** hay **dừng thử nghiệm**.