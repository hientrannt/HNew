# HNew – Trang điểm tin cá nhân

Gom tin từ các báo bạn hay đọc vào một trang, mỗi tin có tiêu đề, tóm tắt ngắn, ảnh và giờ đăng.
Bấm vào tin sẽ mở bài gốc trên trang báo. Giao diện tối ưu cho Galaxy Z Fold:

- **Màn hình ngoài (gập)**: 1 cột, dễ lướt bằng một tay.
- **Màn hình trong (mở)**: tự chia 2–3 cột, xem được nhiều tin cùng lúc.
- Chế độ **Gọn** (☰, mặc định): danh sách dày, ảnh nhỏ bên phải, nhiều tin nhất trên một màn hình. Tắt đi để xem dạng thẻ ảnh lớn.
- Lọc theo **báo** và **chuyên mục** (số bên cạnh là số tin chưa đọc), **tìm kiếm** không cần gõ dấu (⌕).
- Tin đã bấm sẽ mờ đi; nút ◐ để chỉ hiện tin chưa đọc.
- Tự theo chế độ sáng/tối của máy. Có thể "Thêm vào màn hình chính" để mở như một app (PWA).

## Nguồn tin hiện có

| Báo | Cách lấy |
| --- | --- |
| VnExpress (Mới nhất, Kinh doanh, Số hoá, Thế giới) | RSS |
| CafeF (Mới nhất, Chứng khoán, Doanh nghiệp, Tài chính – Ngân hàng, Vĩ mô, Bất động sản) | RSS |
| Tinh tế | RSS |
| Báo Mới (Mới nhất, Nổi bật) | Đọc dữ liệu trang (Báo Mới không có RSS); link được đổi thẳng sang bài gốc của báo đăng tin |

Tuổi Trẻ, Thanh Niên, Dân Trí, BBC Tiếng Việt có sẵn nhưng đang tắt (`"enabled": false`).

### Thêm / bớt nguồn

Sửa `sources.json`:

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
  Đổi model bằng biến môi trường `HNEW_MODEL`.

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
