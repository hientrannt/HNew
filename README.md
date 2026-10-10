# HNews – Trang điểm tin cá nhân

Gom tin từ các báo bạn hay đọc vào một trang, mỗi tin có tiêu đề, tóm tắt ngắn, ảnh và giờ đăng.
Bấm vào tin sẽ mở bài gốc trên trang báo. Giao diện tối ưu cho Galaxy Z Fold:

- **Màn hình ngoài (gập)**: 1 cột, dễ lướt bằng một tay.
- **Màn hình trong (mở)**: tự chia 2–3 cột, xem được nhiều tin cùng lúc.
- Chế độ **Gọn** (☰, mặc định): danh sách dày, ảnh nhỏ bên phải, nhiều tin nhất trên một màn hình. Tắt đi để xem dạng thẻ ảnh lớn.
- Lọc theo **báo** và **chuyên mục** (số bên cạnh là số tin chưa đọc), **tìm kiếm** không cần gõ dấu (⌕).
- Tin đã bấm sẽ mờ đi; nút ◐ để chỉ hiện tin chưa đọc.
- **Đọc liền mạch khi gập/mở máy**: đang đọc ở màn hình ngoài mà mở máy ra (hoặc gập lại), trang không tải lại mà giữ đúng tin đang đọc ở đầu màn hình, chỉ đổi số cột. Thoát app rồi mở lại (trong 12 giờ) cũng quay về đúng chỗ đang đọc dở, bộ lọc được giữ nguyên.
- Tự theo chế độ sáng/tối của máy. Có thể "Thêm vào màn hình chính" để mở như một app (PWA).

## Ứng dụng Android (APK)

**Tải về:** [`dist/HNews-1.1.0.apk`](dist/HNews-1.1.0.apk). Trên GitHub, mở file rồi bấm **Download/View raw**.

Cài đặt trên Galaxy Fold:
1. Mở file APK vừa tải. Nếu Android hỏi, bật **Cho phép cài đặt từ nguồn này** cho trình duyệt hoặc ứng dụng Tệp.
2. Bấm **Cài đặt** rồi **Mở**.
3. Biểu tượng **HNews** sẽ nằm trên màn hình chính.

Khác với bản web, app lấy tin **trực tiếp từ các báo ngay trên điện thoại**, không cần GitHub Pages:
- Mở app là có ngay tin đã lưu, sau đó tự cập nhật (kéo xuống để tải lại, hoặc tự làm mới nếu tin cũ hơn 10 phút).
- Bài báo mở trong trình duyệt nhúng (Chrome Custom Tab); đóng lại là về đúng chỗ đang đọc.
- Tin Báo Mới mở thẳng bài gốc của tờ báo đăng tin.
- Nút **Back** của Android chỉ thu nhỏ app, không thoát. Gập/mở máy, app không tải lại.
- **Cài đặt** (biểu tượng thanh trượt): chủ đề sáng/tối, cỡ chữ, kiểu hiển thị, bật/tắt từng nguồn và chuyên mục.

Các bản APK đều ký bằng cùng khoá `android/app/hnews.keystore`, nên bản mới cài đè lên bản cũ được, không mất dữ liệu.
Khoá này chỉ dùng cho app cá nhân. Muốn dùng khoá riêng thì đặt các biến `HNEWS_KEYSTORE_FILE`, `HNEWS_KEYSTORE_PASSWORD`, `HNEWS_KEY_ALIAS`, `HNEWS_KEY_PASSWORD`.

### Tự build APK

- **Trên GitHub:** tab **Actions → "Build APK Android" → Run workflow**, xong thì tải APK ở mục *Artifacts*.
- **Trên máy:** cần Node 22, JDK 21 và Android SDK 36.

```bash
npm ci
npm run apk          # -> android/app/build/outputs/apk/release/HNews-<phiên bản>-release.apk
```

Đổi logo: sửa `branding/logo-*.svg`, rồi chạy `node branding/render-icons.mjs` và `npx capacitor-assets generate --android`.

## Nguồn tin hiện có

| Báo | Cách lấy |
| --- | --- |
| VnExpress (Mới nhất, Kinh doanh, Số hoá, Thế giới) | RSS |
| CafeF (Mới nhất, Chứng khoán, Doanh nghiệp, Tài chính – Ngân hàng, Vĩ mô, Bất động sản) | RSS |
| Tinh tế | RSS |
| Báo Mới (Mới nhất, Nổi bật) | Đọc dữ liệu trang (Báo Mới không có RSS); link được đổi thẳng sang bài gốc của báo đăng tin |

Tuổi Trẻ, Thanh Niên, Dân Trí, BBC Tiếng Việt có sẵn nhưng đang tắt (`"enabled": false`).

### Thêm / bớt nguồn

Sửa `docs/sources.json` (app Android cần build lại để nhận danh sách mới):

```json
{ "name": "Tên báo", "category": "Chuyên mục", "url": "https://.../rss" }
```

- Nguồn RSS: chỉ cần `url` của RSS (thường ở trang `/rss` của báo).
- Trang Báo Mới: thêm `"type": "baomoi"` và dùng link chuyên mục, ví dụ `https://baomoi.com/kinh-te.epi`.
- Tắt tạm một nguồn: `"enabled": false`.

## Tóm tắt tin

- Mặc định dùng phần **sapo** (đoạn mô tả) mà báo đưa vào RSS, đã làm sạch và cắt gọn khoảng 300 ký tự.
- **Tuỳ chọn, tóm tắt bằng AI:** thêm secret `ANTHROPIC_API_KEY` (Settings → Secrets and variables → Actions).
  Khi đó Claude viết lại mỗi tin thành 1–2 câu nêu ý chính. Tin đã tóm tắt được lưu lại nên mỗi tin chỉ tóm tắt một lần.
  Đổi model bằng biến môi trường `HNEWS_MODEL`.

## Triển khai lên GitHub Pages (miễn phí, tự cập nhật mỗi 30 phút)

1. Merge nhánh này vào `main`.
2. Vào **Settings → Pages → Build and deployment → Source** và chọn **GitHub Actions**.
3. Vào **Actions → "Cập nhật tin & triển khai" → Run workflow** để chạy lần đầu.
4. Mở `https://<tên-github>.github.io/<tên-repo>/` trên điện thoại, chọn menu **⋮ → Thêm vào màn hình chính**.

Workflow `.github/workflows/update-news.yml` chạy mỗi 30 phút: lấy tin, tóm tắt, rồi đăng lại trang.

## Chạy thử trên máy

```bash
python3 scripts/build.py          # lấy tin -> docs/data/news.json (chỉ cần Python 3, không cần cài thêm gì)
cd docs && python3 -m http.server 8000
# mở http://localhost:8000
```

## Cấu trúc

```
sources.json                  danh sách nguồn báo
scripts/build.py              lấy RSS / Báo Mới, làm sạch, tóm tắt -> docs/data/news.json
docs/                         trang web tĩnh (index.html, style.css, app.js, PWA)
.github/workflows/            cập nhật tự động + triển khai GitHub Pages
```
