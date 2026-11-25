# KẾ HOẠCH TRIỂN KHAI CHI TIẾT: HỆ THỐNG TIKTOK LIVE "THẢ ĐÈN HOA ĐĂNG & LỜI CHÚC"

Tài liệu này được thiết kế để **Claude Code** có thể đọc hiểu và triển khai toàn bộ hệ thống một cách bài bản, không bỏ sót các chi tiết hạ tầng, đồng bộ dữ liệu, xử lý âm thanh, tối ưu hiệu năng trên VPS giới hạn tài nguyên và cơ chế tự phục hồi khi chạy dài hạn.

---

## 1. Mục tiêu & Bối cảnh hệ thống

### 1.1. Mục tiêu sản phẩm
- Xây dựng ứng dụng livestream khung dọc **720x1280 @ 30fps** chủ đề **Dòng sông đêm — Thả đèn hoa đăng & Gửi lời chúc**.
- Tương tác trực tiếp với phòng TikTok LIVE qua sự kiện **Chat**, **Gift** và **Like**.
- Tích hợp **Giọng đọc AI (TTS)** có cơ chế hàng đợi âm thanh và giảm âm lượng nhạc nền tự động (*audio ducking*) khi đọc lời chúc/vinh danh.
- Tập trung **chỉ nhận Gift** (không gắn giỏ hàng Affiliate/TikTok Shop), giữ không khí nghệ thuật — chữa lành — lãng mạn, tránh các từ khóa/hình ảnh tâm linh mê tín nhạy cảm.

### 1.2. Môi trường đích (Target Environment)
- **Đã quyết định bỏ qua Oracle Cloud Free Tier** (lý do: CPU 2 OCPU ARM quá sát ngưỡng theo phân tích tải ở Mục 5.4, và chính sách idle-reclaim của Oracle gây thêm rủi ro không cần thiết). Môi trường đích thật sẽ là **một VPS thuê sau, có CPU cao hơn** — nhà cung cấp/kiến trúc cụ thể (x86_64 hoặc ARM64) chốt sau khi Giai đoạn 0 (Mục 7, Bước 0) xác nhận pipeline chạy ổn.
- **Giai đoạn 0 — Thử nghiệm trước khi thuê VPS:** Chạy toàn bộ pipeline trên **GitHub Actions** (tài khoản GitHub phụ, repo public riêng), 1–2 giờ, để xác nhận kết nối/kiến trúc hoạt động đúng trước khi chi tiền thuê VPS. Xem chi tiết Bước 0.
- **Ràng buộc phần cứng chung (áp dụng cho VPS sẽ thuê):**
  - Giả định không có GPU rời; toàn bộ canvas rendering + encoding video `libx264` chạy bằng CPU — cần xác nhận lại với nhà cung cấp cụ thể khi thuê.
  - Cần giữ CPU trung bình an toàn (~40%–65%), tránh spike CPU gây drop frame hoặc đứt kết nối RTMP.
  - Chạy headless qua `Xvfb` + `Chromium` + `PulseAudio` + `FFmpeg`, quản lý vòng đời tiến trình bằng `PM2`.

### 1.3. Rủi ro đã biết & Giới hạn phạm vi giai đoạn thử nghiệm (MVP 7–10 ngày)
- **Rủi ro chính sách TikTok (ToS):** Hệ thống dùng `tiktok-live-connector` (không chính thức) để đọc event và đẩy RTMP từ màn hình ảo/overlay (không phải camera thật). Đây là rủi ro kinh doanh không thể loại bỏ bằng code, chỉ giảm được mức phơi nhiễm.
  - **Bắt buộc:** chạy thử nghiệm 7–10 ngày đầu trên **tài khoản phụ**, không dùng tài khoản chính cho tới khi xác nhận an toàn.
  - Theo dõi "account health" (cảnh báo, bị tắt Gift, bị giới hạn live) như một chỉ số rủi ro, xem Mục 9.
- **Rủi ro phụ thuộc bên thứ ba không có SLA:** `tiktok-live-connector` cần dịch vụ ký signature (EulerStream) có free-tier giới hạn quota; `edge-tts` là API không chính thức, có thể đổi endpoint/rate-limit bất ngờ. Xử lý bằng tách lỗi tạm thời (retry có backoff) khỏi lỗi vĩnh viễn (dừng retry, báo lỗi, không khóa IP/tài khoản), xem Mục 5.1 và 7 (Bước 1).
- **Rủi ro hạ tầng:** Đã bỏ Oracle Free Tier (xem Mục 1.2) nên không còn rủi ro idle-reclaim. VPS sẽ thuê sau vẫn cần kiểm tra chính sách riêng của nhà cung cấp (giới hạn băng thông, chính sách huỷ/khóa tài khoản...). Giữ toàn bộ code + script cài đặt trên Git — không cần hệ thống backup phức tạp ở giai đoạn này.
- **Thu hẹp phạm vi vận hành giai đoạn thử nghiệm:** Chạy theo **ca cố định 3–4 giờ/ngày** (ví dụ 21:00–00:30) thay vì ép treo 24/7 ngay từ đầu. Mục tiêu là đo phản ứng người xem với rủi ro/quota thấp nhất, không phải chứng minh độ bền 24/7 ở tuần đầu.
- **Giới hạn của test trên GitHub Actions (Giai đoạn 0):** Runner GitHub Actions (ví dụ ARM64 public repo: 4 vCPU/16GB) thường **mạnh hơn** VPS mục tiêu sẽ thuê. Test pass trên GitHub Actions chỉ chứng minh pipeline/logic đúng và connector/signing còn quota — **không chứng minh** CPU của VPS thật (sau khi thuê) sẽ đủ tải. Vẫn phải benchmark lại trên VPS thật ở Bước 6.

---

## 2. Kiến trúc tổng thể & Luồng dữ liệu

### 2.1. Các thành phần chính
1. **TikTok Connector & Game/Queue Engine (Node.js + Socket.io):**
   - Kết nối tới phòng live TikTok bằng `tiktok-live-connector` (`WebcastPushConnection`). **Phụ thuộc dịch vụ ký signature bên thứ ba (EulerStream)** — quota free-tier phải được xác minh ở Bước 1 (Mục 7) trước khi code tiếp, vì đây là điều kiện go/no-go cho khả năng chạy dài hơi.
   - Có chế độ **Mock / Simulation Mode** (cho phép giả lập `chat`, `gift`, `like` qua HTTP/WebSocket hoặc giao diện debug khi chưa nối live thật hoặc khi test trên máy cá nhân). **Chỉ bật khi `ENABLE_MOCK=true` cục bộ, server bind `127.0.0.1`; tắt hẳn (`ENABLE_MOCK=false`) và không mở ra ngoài internet khi chạy live thật.**
   - Quản lý `Map` lưu lời chúc gần nhất theo từng `userId`/`uniqueId` để khi user tặng quà ngay sau comment, hệ thống gắn đúng lời chúc đó vào đèn VIP. **Có TTL (ví dụ 15–30 phút) cho mỗi entry + dọn dẹp định kỳ (`setInterval`) để tránh phình bộ nhớ khi chạy nhiều giờ.**
   - Quản lý **Audio Queue** (hàng đợi TTS, có giới hạn độ dài — xem Mục 3.3) và **VIP Wall / Bảng Tri Ân** (lưu top/danh sách người tặng quà gần nhất).
2. **TTS Service (Edge TTS / Pluggable Provider + Cache):**
   - Sinh file `.mp3` ngắn gọn cho lời chúc/vinh danh khi có sự kiện Gift hoặc định kỳ đọc lời chúc nổi bật.
   - Có **Audio Cache** (hash nội dung text + voice) để không gọi lại API cho cùng một câu.
   - Có **Fallback** an toàn nếu TTS lỗi/timeout (vẫn thả đèn và hiện hiệu ứng hình ảnh bình thường, không làm kẹt hàng đợi). **Giai đoạn MVP 7–10 ngày chỉ cần 1 provider (`edge-tts`) + fallback im lặng này là đủ — chưa cần tích hợp provider TTS thứ hai.**
3. **Visual Canvas Stage (HTML5 Canvas + CSS + JS thuần, phục vụ qua Express/HTTP local):**
   - Độ phân giải cố định `720x1280` (tỷ lệ 9:16).
   - Vẽ bầu trời đêm, ánh trăng, mặt nước gợn sóng, hạt đom đóm/ánh sáng chuyển động liên tục (để khung hình luôn sống động, tránh bị nhận diện là màn hình tĩnh).
   - Vẽ các tầng đèn hoa đăng với quỹ đạo trôi uốn lượn tự nhiên, hiển thị Avatar, Tên, Lời chúc.
   - Quản lý phát nhạc nền chill/không lời + phát file âm thanh TTS + tự động *duck* (giảm volume nhạc nền) khi TTS đang phát.
4. **Headless Display & Streamer (`Xvfb` + `Chromium` + `PulseAudio` + `FFmpeg`):**
   - `Xvfb :99 -screen 0 720x1280x24` tạo màn hình ảo.
   - `PulseAudio` tạo virtual sink/source để thu âm thanh từ Chromium và cấp cho FFmpeg.
   - `FFmpeg` chụp màn hình `:99` + thu audio từ PulseAudio, encode `libx264` + `aac` và đẩy lên RTMP endpoint của TikTok.

### 2.2. Luồng xử lý sự kiện (Event Flow)
- **Khi có `chat`:**
  1. Chuẩn hóa & lọc từ khóa xấu/spam/quá dài.
  2. Lưu lời chúc mới nhất của user vào `userWishMap` (kèm timestamp).
  3. Đẩy event `spawn_lantern` (tier: `normal`) tới frontend qua Socket.io.
  4. Frontend sinh đèn hoa đăng thường (kích thước chuẩn, thời gian trôi ~25s).
- **Khi có `like`:**
  1. Throttle/gom nhóm (ví dụ mỗi vài trăm ms hoặc mỗi N like) để tránh spam event.
  2. Đẩy event `spawn_sparkle` tới frontend -> sinh gợn sóng lấp lánh / đom đóm bay lên.
- **Khi có `gift`:**
  1. Phân loại tier quà theo cấu hình (`tier1_small`, `tier2_medium`, `tier3_royal`) dựa trên `diamondCount` / `repeatCount` / tên quà.
  2. Lấy lời chúc gần nhất của user từ `userWishMap` (nếu không có thì dùng câu mặc định nhẹ nhàng như *"Gửi lời bình an & vạn sự hanh thông"*).
  3. Cập nhật danh sách **Bảng Tri Ân** (giới hạn số lượng hiển thị rõ ràng, không che nội dung chính).
  4. Đẩy event `spawn_lantern` (tier tương ứng: Sen Hồng / Đèn Trời Khổng Minh / Thuyền Hoa Đăng Hoàng Gia) tới frontend.
  5. Đẩy yêu cầu đọc lời chúc vào **TTS Audio Queue** (tùy theo tier và tần suất cấu hình).

---

## 3. Thiết kế chi tiết Gameplay, Phân tầng Gift & Giọng đọc AI

### 3.1. Phân tầng đèn & quà tặng (Cấu hình linh hoạt qua file config)
Tất cả ngưỡng quà và thời gian tồn tại phải đặt trong file cấu hình để dễ tinh chỉnh mà không cần sửa code:
- **Đèn Thường (Comment miễn phí):**
  - Hình dáng: Đèn hoa đăng giấy ấm áp.
  - Nội dung: Avatar + Tên + Lời chúc (tối đa ký tự có thể cấu hình, ví dụ 80–120 ký tự, tự xuống dòng/cắt gọn tránh tràn khung).
  - Thời gian tồn tại trên màn hình: ~24–28 giây.
- **Tier 1 — Đèn Hoa Sen Hồng (Quà nhỏ, ví dụ 1–9 xu):**
  - Hình dáng: Hoa sen hồng phát sáng lớn hơn đèn thường (~1.4x–1.6x), có quầng sáng dịu.
  - Thời gian tồn tại: ~40–45 giây, tốc độ trôi chậm hơn để dễ đọc.
  - Audio: Có thể phát chuông/nhạc nhẹ + đưa vào hàng đợi TTS nếu không quá dày.
- **Tier 2 — Đèn Trời Khổng Minh (Quà tầm trung, ví dụ 10–99 xu):**
  - Hình dáng: Đèn lồng/đèn trời bay vút từ mặt sông lên bầu trời đêm kèm vệt sáng và pháo hoa nhẹ.
  - Audio: Ưu tiên đọc lời chúc bằng giọng AI (kèm tên người gửi).
- **Tier 3 — Thuyền Hoa Đăng Hoàng Gia (Quà lớn, ví dụ >= 100 xu):**
  - Hình dáng: Thuyền hoa đăng rực rỡ trôi ngang khu vực nổi bật, ánh trăng/mặt nước đổi sắc thái ấm áp trong ~12–15 giây, cập nhật vị trí vinh danh ở Bảng Tri Ân.
  - Audio: Ưu tiên cao nhất trong hàng đợi TTS, đọc lời chúc kèm lời cảm ơn trang trọng.

### 3.2. Bố cục khung hình dọc `720x1280` (Safe Zones)
Cần chừa vùng an toàn vì giao diện TikTok LIVE có các thành phần đè lên màn hình:
- **Vùng trên cùng (`y: 0..160`):** Tiêu đề nhẹ nhàng + **Bảng Tri Ân** gọn gàng (tối đa 3–5 người gần nhất/cao nhất, không chiếm quá ~12–15% chiều cao màn hình).
- **Vùng giữa (`y: 160..920`):** Dòng sông đêm, ánh trăng, đom đóm, các lớp đèn hoa đăng trôi theo chiều sâu (parallax/scale nhẹ theo độ sâu).
- **Vùng dưới (`y: 920..1280`):** Vùng dễ bị khung chat và nút tương tác của TikTok che khuất -> tránh đặt chữ quan trọng/bảng điểm ở sát mép dưới, chỉ để mặt nước/sóng/đèn bắt đầu nổi lên từ phía dưới.

### 3.3. Quy tắc Giọng đọc AI (MC Radio Đêm Khuya)
- **Giọng đọc:** Mặc định hỗ trợ tiếng Việt tự nhiên qua `edge-tts` (ví dụ `vi-VN-HoaiMyNeural` hoặc `vi-VN-NamMinhNeural` cấu hình được trong `.env` / `config.json`).
- **Hàng đợi tuần tự (Sequential Queue):** Tuyệt đối không phát chồng nhiều file TTS cùng lúc. Mỗi item có `maxDuration` / timeout để nếu file lỗi hoặc kẹt thì tự bỏ qua và chuyển sang item kế tiếp.
- **Giới hạn độ dài hàng đợi (Queue Cap):** Tối đa ~5–8 item đang chờ. Khi vượt ngưỡng (gift-combo dồn dập), bỏ các item cũ nhất hoặc gộp thành một lời cảm ơn chung, giữ hàng đợi luôn bám sát thời điểm thực — không để giọng đọc trễ hàng phút so với sự kiện gốc.
- **Chống spam / Giữ trải nghiệm thư giãn:**
  - Có `minGapMs` giữa 2 lần đọc TTS (ví dụ tối thiểu 4–6 giây nghỉ giữa các câu đọc).
  - Có chế độ tự động đọc ngẫu nhiên 1 lời chúc đẹp mỗi `ambientReadIntervalSec` (ví dụ mỗi 150–180 giây) nếu không có sự kiện quà tặng gần đó, giúp phiên live luôn có nhịp điệu.
  - **Audio Ducking:** Khi TTS bắt đầu phát -> giảm volume nhạc nền (ví dụ từ `0.25` xuống `0.07`); khi TTS kết thúc -> tăng volume nhạc nền trở lại mượt mà.

---

## 4. Cấu trúc thư mục dự án đề xuất

Claude Code nên tổ chức mã nguồn theo cấu trúc rõ ràng, tách biệt logic backend, giao diện canvas, âm thanh và script vận hành:

```text
lantern-live-stream/
├── config/
│   ├── default.json              # Cấu hình tier quà, thời gian đèn, âm lượng, TTS, vùng an toàn
│   └── banned-words.json         # Danh sách từ khóa cấm / từ nhạy cảm lọc lời chúc
├── src/
│   ├── server.js                 # Entry point Express + Socket.io + tích hợp các module
│   ├── tiktok/
│   │   ├── connector.js          # Kết nối tiktok-live-connector, auto-reconnect, chuẩn hóa event
│   │   └── mockEmitter.js        # Giả lập chat / gift / like để test offline hoặc dry-run
│   ├── game/
│   │   ├── wishStore.js          # Lưu lời chúc gần nhất theo user, lọc & làm sạch text
│   │   ├── giftClassifier.js     # Phân loại quà vào tier1 / tier2 / tier3
│   │   └── tributeBoard.js       # Quản lý danh sách vinh danh / Bảng Tri Ân
│   ├── tts/
│   │   ├── ttsEngine.js          # Sinh audio (edge-tts + cache hash + timeout/fallback)
│   │   └── audioQueue.js         # Hàng đợi phát TTS tuần tự, tránh nghẽn
│   └── utils/
│       └── logger.js             # Ghi log có timestamp, phân cấp info/warn/error
├── public/
│   ├── index.html                # Trang hiển thị chính 720x1280
│   ├── test-panel.html           # Bảng điều khiển giả lập chat/gift/like/TTS để test nhanh
│   ├── css/
│   │   └── style.css             # Reset margin/padding, khóa kích thước 720x1280, font chữ
│   └── js/
│       ├── canvasStage.js        # Vẽ bầu trời, mặt nước, đom đóm, đèn hoa đăng, hiệu ứng tier
│       ├── audioManager.js       # Quản lý nhạc nền, phát TTS, audio ducking
│       └── socketClient.js       # Nhận event từ server & điều phối hiển thị/âm thanh
├── assets/
│   ├── audio/
│   │   ├── bgm/                  # Các file nhạc không lời (.mp3 / .ogg) đặt tại đây
│   │   └── chimes/               # Tiếng chuông / hiệu ứng nhẹ khi thả đèn/nhận quà (tùy chọn)
│   ├── avatars/
│   │   └── default-avatar.png    # Ảnh đại diện dự phòng khi không tải được avatar user
│   └── cache/
│       └── tts/                  # Thư mục cache file .mp3 sinh từ TTS (tự tạo, đưa vào .gitignore)
├── scripts/
│   ├── setup-oracle-ubuntu.sh    # Script cài Node.js, PM2, Xvfb, Chromium, PulseAudio, FFmpeg, python/edge-tts
│   ├── start-virtual-display.sh  # Khởi chạy Xvfb :99 và cấu hình PulseAudio virtual sink/source
│   ├── start-ffmpeg-rtmp.sh      # Lệnh FFmpeg đẩy luồng 720x1280 @ 30fps lên RTMP
│   └── health-check.sh           # Kiểm tra trạng thái tiến trình, CPU/RAM, cổng web, log lỗi
├── ecosystem.config.js           # Cấu hình PM2 cho toàn bộ tiến trình (server, xvfb, browser, ffmpeg)
├── .env.example                # Mẫu biến môi trường (TIKTOK_USERNAME, RTMP_URL, STREAM_KEY, PORT, TTS_VOICE...)
├── .gitignore
└── package.json
```

---

## 5. Chi tiết kỹ thuật cho từng module (Tránh lỗi thường gặp)

### 5.1. Kết nối TikTok & Auto-Reconnect (`src/tiktok/connector.js`)
- Đọc `TIKTOK_USERNAME` từ biến môi trường.
- Lắng nghe các sự kiện cốt lõi: `chat`, `gift`, `like`, `disconnected`, `error`, `streamEnd`.
- **Lỗi hay gặp:** Kết nối WebSocket bị ngắt sau vài giờ hoặc phòng live chưa mở/tạm dừng.
  - **Giải pháp:** Cài đặt cơ chế reconnect theo cấp số nhân có giới hạn (ví dụ: 5s, 10s, 20s, tối đa 60s), dọn dẹp listener cũ trước khi tạo kết nối mới để tránh rò rỉ bộ nhớ và nhân đôi sự kiện.
- **Lỗi signature/quota (EulerStream) — khác với mất kết nối tạm thời:** Nếu lỗi là do signature bị từ chối hoặc hết quota (không phải lỗi mạng), **dừng retry ngay** (không lặp vô hạn gây spam/khóa IP), ghi log rõ nguyên nhân, và báo trạng thái "cần can thiệp thủ công" thay vì tiếp tục cố nối lại.

### 5.2. Xử lý Lời Chúc & Bảo mật hiển thị (`src/game/wishStore.js`)
- **Lỗi hay gặp:** Người dùng gửi thẻ HTML/script, ký tự điều khiển, emoji quá dài, hoặc từ ngữ thô tục/nhạy cảm làm vỡ layout đèn hoặc vi phạm chính sách.
  - **Giải pháp:**
    - Escape/strip HTML tags, loại bỏ ký tự điều khiển, chuẩn hóa khoảng trắng.
    - Kiểm tra danh sách từ cấm (`config/banned-words.json` — hỗ trợ cả so khớp từ/cụm từ và biến thể viết cách/ký tự cơ bản). Nếu vi phạm thì bỏ qua hoặc thay bằng lời chúc an toàn mặc định.
    - Giới hạn độ dài lời chúc (ví dụ tối đa 90 ký tự) và tên hiển thị (tối đa 24 ký tự).
    - **TTL + cleanup định kỳ:** Mỗi entry trong `userWishMap` hết hạn sau 15–30 phút không hoạt động; chạy `setInterval` dọn định kỳ (ví dụ mỗi 5 phút) để Map không phình vô hạn trong ca live dài.

### 5.3. Avatar người dùng trên Canvas (`public/js/canvasStage.js`)
- **Lỗi hay gặp:** URL avatar TikTok có thể hết hạn, chặn hotlink/CORS trên Chromium headless, hoặc tải chậm gây nháy khung hình.
  - **Giải pháp:**
    - Tạo bộ cache ảnh `HTMLImageElement` phía client (hoặc proxy/tải trước về local nếu cần) kèm `crossOrigin = "anonymous"`.
    - Nếu ảnh lỗi hoặc chưa tải kịp, lập tức dùng `default-avatar.png` hoặc vẽ vòng tròn chữ cái đầu tên, không để ảnh vỡ hay treo render loop.

### 5.4. Render Loop & Tối ưu CPU (áp dụng cho mọi VPS mục tiêu, CPU cụ thể chốt sau Giai đoạn 0)
- Khóa vòng lặp vẽ ở **30 FPS** (không để `requestAnimationFrame` vẽ thừa hoặc tạo hàng nghìn particle nặng).
- **Giới hạn số lượng đèn hoa đăng (`maxConcurrentLanterns`) đặt mặc định thấp (ví dụ 20), để trong config, không hard-code 35–45** — đây là số chưa benchmark, chỉ tăng dần sau khi đo CPU thật trên VPS/GitHub Actions; nếu vượt ngưỡng thì ưu tiên giữ đèn VIP/mới nhất và đẩy dần đèn cũ ra khỏi khung hình.
- **Pre-render sprite cho hiệu ứng tốn CPU — không vẽ sống mỗi frame:**
  - Quầng sáng/glow (shadowBlur, radial gradient) phải được vẽ sẵn ra ảnh/offscreen canvas một lần khi đèn spawn, sau đó chỉ `drawImage` mỗi frame — tuyệt đối không gọi `ctx.shadowBlur` hoặc tính gradient lại mỗi frame.
  - Text tên + lời chúc (có dấu tiếng Việt, shaping font tốn CPU) cũng pre-render ra bitmap riêng khi đèn spawn, chỉ `drawImage` lại khi di chuyển.
- **Degraded mode (dự phòng khi quá tải):** nếu CPU đo được vượt ngưỡng cấu hình liên tục, tự động giảm fps từ 30 xuống 24 hoặc tạm tắt hiệu ứng phụ (đom đóm/gợn sóng) thay vì để drop frame/đứt RTMP.
- Trên VPS không có GPU:
  - Chạy Chromium với các cờ phù hợp cho headless trên Linux (`--no-sandbox`, `--disable-dev-shm-usage`, `--window-size=720,1280`, `--autoplay-policy=no-user-gesture-required` để cho phép tự phát nhạc nền & TTS không cần click chuột).
  - Cân nhắc `--use-gl=angle --use-angle=swiftshader` hoặc chạy 2D canvas chuẩn tùy mức CPU thực tế khi benchmark; **bắt buộc đo bằng `htop` / `mpstat` trong lúc chạy thật, cả trên GitHub Actions (Giai đoạn 0) và VPS thật (Bước 6)**.
  - Nếu VPS cuối cùng là ARM: xác minh `ffmpeg`/`libx264` được build có NEON SIMD (không phải scalar generic) trước khi tin vào tốc độ `preset ultrafast`.

### 5.5. Cấu hình FFmpeg đẩy RTMP (`scripts/start-ffmpeg-rtmp.sh`)
- Đọc `RTMP_URL` và `STREAM_KEY` từ `.env`.
- Ghép `RTMP_URL` + `STREAM_KEY` đúng chuẩn (xử lý trường hợp `RTMP_URL` có hoặc không có dấu `/` ở cuối).
- Thông số video khuyến nghị khởi điểm (áp dụng mọi VPS, tinh chỉnh lại theo CPU thực tế đo được):
  - Input video: `-f x11grab -s 720x1280 -r 30 -i :99`
  - Input audio: `-f pulse -i default` (hoặc virtual sink monitor của PulseAudio)
  - Video codec: `-c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -b:v 2500k -maxrate 2500k -bufsize 5000k -g 60 -keyint_min 60`
  - Audio codec: `-c:a aac -b:a 128k -ar 44100 -ac 2`
  - Output: `-f flv "<RTMP_FULL_URL>"`
- **Lưu ý:** Không log lộ `STREAM_KEY` ra file log công khai.

### 5.6. Đồng bộ vòng đời Chromium & FFmpeg (tránh màn hình đen/đứng hình)
- **Lỗi hay gặp:** `lantern-browser` crash và PM2 tự khởi động lại trong vài giây, nhưng `lantern-ffmpeg` vẫn tiếp tục chụp màn hình `:99` -> khán giả thấy khung hình đứng hoặc đen trong lúc chờ.
  - **Giải pháp:** `health-check.sh` (hoặc endpoint `/health` của `lantern-web`) phải xác nhận trang đã render xong (ví dụ canvas đã vẽ frame đầu tiên) trước khi `lantern-ffmpeg` được phép khởi động/tiếp tục đẩy luồng; nếu browser restart giữa phiên, tạm dừng hoặc che bằng cảnh chờ an toàn thay vì để FFmpeg đẩy khung hình lỗi lên RTMP.

### 5.7. Bảo mật Mock/Test Endpoint
- **Lỗi hay gặp:** `test-panel.html` và các endpoint giả lập chat/gift/like bị bỏ quên mở ra ngoài internet, cho phép bất kỳ ai điều khiển hiệu ứng trên stream thật.
  - **Giải pháp:** `lantern-web` chỉ bind `127.0.0.1` khi `ENABLE_MOCK=true`; bắt buộc đặt `ENABLE_MOCK=false` trong `.env` khi chạy live thật, và không expose port mock ra firewall/public.

---

## 6. Quản lý tiến trình với PM2 (`ecosystem.config.js`)

Tách riêng các tiến trình trong `ecosystem.config.js` để dễ theo dõi và khởi động lại độc lập khi một thành phần gặp sự cố:
1. `lantern-web`: Node.js server (Express + Socket.io + TikTok connector + TTS queue).
2. `lantern-xvfb`: Khởi tạo màn hình ảo `:99` và môi trường PulseAudio.
3. `lantern-browser`: Mở Chromium trỏ tới `http://127.0.0.1:${PORT}` trên `DISPLAY=:99` (đợi `lantern-web` sẵn sàng trước khi mở).
4. `lantern-ffmpeg`: Đẩy luồng `720x1280 @ 30fps` lên RTMP (chỉ bật khi `ENABLE_RTMP=true` trong `.env` để tránh đẩy nhầm khi đang test). **Chỉ khởi động/tiếp tục sau khi `health-check` xác nhận `lantern-browser` đã render ổn định (xem Mục 5.6).**

---

## 7. Quy trình triển khai & Kiểm thử từng bước (Step-by-Step)

Claude Code nên thực hiện theo thứ tự dưới đây và xác nhận từng bước trước khi chuyển sang bước tiếp theo:

### Bước 0: Thử nghiệm pipeline trên GitHub Actions (trước khi thuê VPS)
- Người dùng tự tạo một **tài khoản GitHub phụ** (tách khỏi tài khoản chính) và đăng nhập `gh auth login` trên máy, hoặc xác nhận tài khoản phụ nào sẽ dùng.
- Tạo một **repo public mới** dưới tài khoản phụ; duplicate code hiện có trong `packages/floating-lanterns` sang repo đó (khởi tạo git mới, không mang lịch sử commit của repo chính).
- Viết workflow GitHub Actions (`.github/workflows/`), **chỉ trigger bằng `workflow_dispatch`** (không dùng `pull_request`/`pull_request_target` để tránh lộ secret qua PR từ repo public) — cài Node.js, `ffmpeg`, `Xvfb`, `Chromium`, `PulseAudio`, font tiếng Việt (`fonts-noto`, `fonts-dejavu`), `edge-tts`.
- Lưu `TIKTOK_USERNAME` (tài khoản TikTok phụ), `RTMP_URL`, `STREAM_KEY` vào **GitHub Actions Secrets** của repo phụ — không log ra output.
- Chạy thử 1–2 giờ, theo dõi: kết nối `tiktok-live-connector`/quota EulerStream còn hoạt động không, pipeline canvas → audio → ffmpeg → RTMP lên hình ổn định không, tài khoản TikTok phụ có bị cảnh báo không.
- **Gate quyết định:** Pass (pipeline chạy đúng, connector còn quota, tài khoản phụ không bị cảnh báo) → tiến hành thuê VPS (CPU cao hơn Oracle Free Tier, nhà cung cấp/kiến trúc chốt tại thời điểm thuê) và tiếp tục Bước 1. Fail → debug trên GitHub Actions trước, chưa chi tiền thuê VPS.
- **Lưu ý:** test này không thay thế benchmark CPU thật ở Bước 6, vì runner GitHub Actions thường mạnh hơn VPS mục tiêu (xem Mục 1.3).

### Bước 1: Khởi tạo repo & cấu hình cơ bản
- Tạo `package.json`, `.env.example`, `.gitignore`, `config/default.json`, `config/banned-words.json`, `src/utils/logger.js`.
- Cài đặt các package Node.js cần thiết (`express`, `socket.io`, `tiktok-live-connector`, `dotenv`).
- **Gate bắt buộc trước khi sang Bước 2:** Thử kết nối `tiktok-live-connector` tới một phòng live thật (tài khoản phụ) và xác minh quota/giới hạn của dịch vụ ký signature (EulerStream) ở mức free-tier. Nếu quota không đủ cho mục tiêu vận hành (xem ca cố định ở Mục 1.3), quyết định go/no-go hoặc nâng cấp dịch vụ trước khi code tiếp Game Engine/Canvas.

### Bước 2: Xây dựng Game Engine, Wish Store, Gift Classifier & TTS Queue
- Viết `src/game/wishStore.js`, `src/game/giftClassifier.js`, `src/game/tributeBoard.js`.
- Viết `src/tts/ttsEngine.js` (hỗ trợ `edge-tts` qua CLI/child_process với timeout, cache theo hash, và cơ chế tắt/bật linh hoạt) và `src/tts/audioQueue.js`.
- Viết `src/tiktok/connector.js` và `src/tiktok/mockEmitter.js`.

### Bước 3: Xây dựng Giao diện Canvas 720x1280 & Audio Manager
- Viết `public/index.html`, `public/css/style.css`, `public/js/canvasStage.js`, `public/js/audioManager.js`, `public/js/socketClient.js`.
- Viết `public/test-panel.html` cho phép bấm gửi:
  - Comment lời chúc thường (có thể chọn tên/avatar test).
  - Gift Tier 1, Tier 2, Tier 3 kèm lời chúc.
  - Like hàng loạt.
  - Test phát TTS & kiểm tra nhạc nền tự giảm âm lượng (ducking).

### Bước 4: Kiểm thử cục bộ (Local / Dry-run Test)
- Chạy `node src/server.js` với `ENABLE_MOCK=true`.
- Mở trình duyệt ở khung `720x1280` và dùng `test-panel.html` để kiểm tra:
  - Đèn trôi mượt, không chồng chéo/tràn chữ xấu.
  - Phân biệt rõ 3 tier đèn hoa đăng.
  - Hàng đợi TTS đọc lần lượt, không chồng tiếng, không treo khi mạng/TTS chậm.
  - Nhạc nền tự hạ âm lượng khi TTS nói và bật lại sau khi nói xong.

### Bước 5: Tạo bộ script vận hành cho VPS mục tiêu (Ubuntu, kiến trúc chốt theo VPS đã thuê ở Bước 0)
- Viết `scripts/setup-oracle-ubuntu.sh` (giữ tên hoặc đổi tên theo nhà cung cấp thật khi thuê), `scripts/start-virtual-display.sh`, `scripts/start-ffmpeg-rtmp.sh`, `scripts/health-check.sh` và `ecosystem.config.js`.
- Script cài đặt phải cài rõ **gói font hỗ trợ tiếng Việt** (ví dụ `fonts-noto`, `fonts-dejavu`) — Ubuntu Minimal không có font nào theo mặc định, dễ gây lỗi hiển thị ký tự vuông dù code đúng.
- `health-check.sh` phải xác nhận trang web đã render (không chỉ process còn sống) trước khi cho phép `lantern-ffmpeg` đẩy luồng (xem Mục 5.6).
- Đảm bảo cấp quyền thực thi (`chmod +x scripts/*.sh`) và kiểm tra cú pháp bash (`bash -n`).

### Bước 6: Triển khai & Chạy thử trên VPS mục tiêu (thuê sau khi Bước 0 pass)
- Đưa code lên VPS, tạo `.env` từ `.env.example`.
- Chạy script cài đặt (Bước 5) và kiểm tra `edge-tts`, `ffmpeg`, `Xvfb`, `pulseaudio`, `node`, `pm2`.
- Chạy thử `lantern-web`, `lantern-xvfb`, `lantern-browser` (với `ENABLE_RTMP=false` trước), kiểm tra chụp ảnh/xem giao diện render trên `:99` để chắc chắn không bị màn hình đen hay lỗi font tiếng Việt.
- Bật `ENABLE_RTMP=true` test đẩy luồng trong tối thiểu 30–60 phút, theo dõi `pm2 status`, `pm2 logs`, và mức tiêu thụ CPU/RAM (`htop` / `free -h`).
- **Giai đoạn thử nghiệm 7–10 ngày tiếp theo:** chạy theo ca cố định 3–4 giờ/ngày trên tài khoản phụ (xem Mục 1.3), không ép treo 24/7. Theo dõi các chỉ số ở Mục 9 sau mỗi ca.

---

## 8. Checklist nghiệm thu cuối cùng (Definition of Done)

- [ ] Giao diện hiển thị đúng tỷ lệ dọc `720x1280`, font tiếng Việt hiển thị đầy đủ dấu, không lỗi font vuông.
- [ ] Nhạc nền và giọng đọc AI phát được tự động trong Chromium headless mà không cần thao tác chuột thủ công.
- [ ] Khi có comment -> thả đèn thường; khi có gift -> thả đèn đúng tier + cập nhật Bảng Tri Ân + đọc lời chúc qua TTS (nếu bật).
- [ ] Mất kết nối TikTok WebSocket hoặc lỗi 1 file TTS không làm sập server Node.js.
- [ ] Chạy liên tục trên VPS mục tiêu đã thuê (Bước 0 pass trên GitHub Actions trước) không bị tràn RAM, không treo hàng đợi audio, CPU giữ ở mức ổn định.
- [ ] Có tài liệu hướng dẫn ngắn gọn cách thêm nhạc nền vào `assets/audio/bgm/`, cách lấy/cập nhật `STREAM_KEY` và cách xem log khi sự cố.

---

## 9. Tiêu chí đo lường sau 7–10 ngày thử nghiệm (Go/No-Go)

Sau mỗi ca live (3–4 giờ/ngày, tài khoản phụ — xem Mục 1.3), ghi lại:
- **Lượng người xem trung bình** trong ca.
- **Tỷ lệ người comment thả đèn** (số comment sinh lantern / số viewer unique).
- **Tổng Gift phát sinh** và **trạng thái tài khoản** (có bị cảnh báo, giới hạn live, hoặc tắt quyền nhận Gift không — đây là chỉ số rủi ro ToS quan trọng nhất, xem Mục 1.3).

Sau 7–10 ngày, dùng 3 chỉ số trên để quyết định: tiếp tục mở rộng (chuyển tài khoản chính / tăng giờ live), giữ nguyên quy mô, hay dừng điều chỉnh kiến trúc trước khi đi tiếp.