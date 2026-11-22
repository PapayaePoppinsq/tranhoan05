# Sân Vợt

Website đặt sân pickleball tại Thái Nguyên. Giao diện tiếng Việt chạy trên trình duyệt điện thoại và máy tính.

## Chạy trên máy

Yêu cầu Node.js 24 trở lên và npm. Mở terminal tại thư mục `pickleball-web` rồi chạy:

```powershell
npm.cmd ci
npm.cmd run dev
```

Mở [website](http://localhost:5173). API chạy riêng ở [cổng 4311](http://localhost:4311/api/health). Frontend chuyển yêu cầu `/api` sang backend qua proxy Vite. Có thể chạy từng phần bằng `npm.cmd run dev:api` và `npm.cmd run dev:web` ở hai terminal.

Lệnh `dev` bật chế độ thử nếu chưa đặt `DEMO_MODE`. Bạn có thể đăng ký tài khoản khách, chọn sân và ngày, xác nhận giữ chỗ rồi bấm **Mô phỏng thanh toán**. Để bật tài khoản quản trị, tạo `backend/.env` từ `.env.example`, đặt mật khẩu riêng `ADMIN_PASSWORD` từ 12 đến 128 ký tự và khởi động lại. Tên đăng nhập quản trị là `0900000000`. Chủ sân đăng ký tài khoản thông thường, sau đó quản trị viên đối chiếu tài khoản với chủ sân và gán số điện thoại cho cụm sân.

```powershell
npm.cmd test
npm.cmd run build
npm.cmd start
```

Sau khi build, `npm.cmd start` phục vụ cả giao diện lẫn API tại [http://localhost:4311](http://localhost:4311). Để thử thanh toán mô phỏng trên bản build, đặt `DEMO_MODE=true` và `PUBLIC_ORIGIN=http://localhost:4311` trong `.env`. Chế độ thử chỉ phục vụ tên máy cục bộ. Nếu đổi cổng backend khi dùng Vite, đặt `VITE_BACKEND_TARGET` tương ứng cho tiến trình frontend.

## Cấu trúc và thư viện

| Thư mục | Chức năng | Thư viện chính |
| --- | --- | --- |
| `frontend/` | Tìm sân, bản đồ, đặt sân, tài khoản, quản trị | React và React Router dựng giao diện và định tuyến. Leaflet hiển thị bản đồ và ghim. Lucide cung cấp biểu tượng. Vite chạy và build. |
| `backend/` | API, tài khoản, lịch, gợi ý, thanh toán, lưu dữ liệu | Express xử lý HTTP. Zod kiểm tra dữ liệu. express-rate-limit giới hạn tần suất đăng nhập và tìm kiếm. csv-parse đọc danh bạ. `@payos/node` kết nối payOS và xác thực webhook. SQLite dùng `node:sqlite` đi kèm Node.js. |

`package-lock.json` khóa phiên bản của cả hai phần. SQLite tạo file khi chạy lần đầu trong `backend/var`. Giữ thư mục đó khi cần lưu tài khoản và đơn. Hai chế độ dùng file dữ liệu riêng theo mặc định.

## Triển khai giao diện trên Cloudflare Pages

Kết nối GitHub với **Pages** và chọn repo này, nhánh `main`. Để thư mục gốc trống, đặt build command `npm run build`, build output directory `frontend/dist`, và build variable `NODE_VERSION=24.13.0`. Lệnh build tạo `catalog.json` từ CSV và dữ liệu ảnh trước khi Vite đóng gói giao diện.

Khi chưa có API, Pages hiển thị danh bạ tĩnh gồm 25 sân, ảnh đã đối chiếu, bản đồ và khoảng cách đường chim bay từ vị trí khách. Đây chỉ là thông tin tham khảo. Đăng nhập, lưu sân, lịch trống, chatbot và đặt sân cần backend cùng kho dữ liệu bền vững. Proxy trong `frontend/vite.config.js` chỉ chạy khi phát triển trên máy, không đi theo bản build Pages.

### Backend Cloudflare Worker

Thư mục `worker/` đóng gói API Express trong một Worker và dùng một Durable Object SQLite để lưu tài khoản, sân, lịch và đơn. Dữ liệu được giữ trên Cloudflare thay vì file SQLite tạm của Worker. Thư mục `functions/` chuyển các yêu cầu `/api/*` và ảnh quản trị từ Pages sang Worker cùng nguồn gốc trình duyệt; cookie đăng nhập tiếp tục thuộc miền Pages.

1. Đăng nhập Wrangler vào **cùng tài khoản Cloudflare chứa dự án Pages**. Kiểm tra bằng `wrangler whoami` và `wrangler pages project list`.
2. Chạy `npm ci`, `npm run build`, rồi `wrangler deploy --config worker/wrangler.jsonc`. Kiểm tra `https://<worker>.workers.dev/api/health` trả `{"ok":true}`.
3. Trong dự án Pages `tranhoan05`, đặt biến môi trường production `BACKEND_ORIGIN` bằng gốc HTTPS của Worker, không có `/api` ở cuối. Redeploy Pages từ nhánh `main` để hàm proxy đọc biến mới.
4. Đặt secret `ADMIN_PASSWORD` riêng cho Worker bằng `wrangler secret put ADMIN_PASSWORD --config worker/wrangler.jsonc`, rồi triển khai lại. Không ghi mật khẩu vào Git. Số đăng nhập quản trị là `0900000000`.

Các sân từ CSV chưa có bảng giá và sân nhỏ đã xác minh. Quản trị viên cần nhập thông tin thật trước khi mở đặt. Khi chưa có đủ khóa payOS, API trả `payment: "off"` và giao diện không cho chốt đơn; chỉ bật thanh toán sau khi kiểm tra tài khoản nhận tiền, webhook và thông tin sân. `PUBLIC_ORIGIN` trong `worker/wrangler.jsonc` phải trùng chính xác miền Pages đang dùng.

## Cấu hình dịch vụ ngoài

```powershell
Copy-Item .\backend\.env.example .\backend\.env
```

| Biến cấu hình | Tác dụng |
| --- | --- |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Bật Gemini để chuyển câu tiếng Việt thành bộ lọc. Dùng tên model hỗ trợ JSON theo [tài liệu Gemini](https://ai.google.dev/gemini-api/docs/structured-output). Khi thiếu cấu hình hoặc dịch vụ gián đoạn, giao diện báo đang tìm bằng quy tắc. |
| `ORS_API_KEY` | Hiện quãng đường lái xe và vẽ tuyến với [openrouteservice](https://openrouteservice.org/). Khi thiếu khóa hoặc API gián đoạn, danh sách ghi khoảng cách đường chim bay và trang sân có nút mở chỉ đường ngoài. [Máy chủ bản đồ OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/) có chính sách sử dụng riêng. |
| `DEMO_MODE=false`, `ADMIN_PASSWORD` | Chuyển sang cơ sở dữ liệu riêng cho vận hành. Đặt mật khẩu quản trị từ 12 ký tự khi khởi tạo. Chỉ sân đã được quản trị viên xác minh mới có thể nhận đặt. |
| `PUBLIC_ORIGIN`, `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` | Đặt địa chỉ HTTPS thật của website và khóa từ kênh [payOS](https://payos.vn/docs/sdks/back-end/node/). Trỏ webhook về `<PUBLIC_ORIGIN>/api/payments/payos/webhook`. Bản triển khai sử dụng một kênh nhận tiền cho nền tảng. |

Để dùng bên ngoài máy phát triển, chạy build và API sau máy chủ HTTPS, đặt `PUBLIC_ORIGIN` trùng với tên miền và dùng ổ đĩa lưu trữ bền vững cho SQLite. Các kết nối AI, định tuyến và payOS phụ thuộc vào gói của tài khoản. Kiểm tra phí và hạn mức với nhà cung cấp trước khi bật. Khóa dịch vụ nằm trong `.env` backend.

## Luồng đặt sân

Tìm thủ công, Đặt nhanh và Chatbot cùng đi qua **Xem lại đơn**. Backend tính lại giá và ghi giữ chỗ bằng giao dịch SQLite. Trigger trong cơ sở dữ liệu chặn các khoảng giờ chồng lấn trên một sân, kể cả khi hai yêu cầu tới cùng lúc. Giữ chỗ hết hạn sau tối đa 10 phút hoặc khi tới giờ bắt đầu. Với payOS, backend xác minh chữ ký, đối chiếu mã đơn, mã liên kết, tiền tệ và số tiền. Webhook lặp được xử lý một lần. Thanh toán đúng nhưng tới muộn chuyển sang đối soát.

## Dữ liệu và ảnh

`backend/data/thai-nguyen.csv` là file danh bạ duy nhất. File chứa 25 sân và các cột liên kết ảnh từ bản CSV mới nhất. Sân hiển thị loại địa điểm, địa chỉ, giờ hoạt động, đánh giá, số điện thoại và vị trí theo dữ liệu trong file. Với dòng ghi cả một khung giờ và “Mở cả ngày”, lịch dùng khung giờ cụ thể. “Mở cả ngày (24/24)” dùng 00:00–24:00.

`backend/data/catalog-photos.json` ghi ảnh đã chọn theo mã, tên và địa chỉ sân, nguồn đối chiếu và lý do bỏ trống. Có 16 ảnh chụp lưu trong `frontend/public/images/san-thuc-te/`. Chín sân còn lại hiện “Chưa có ảnh xác minh” vì dữ liệu chỉ có thẻ giới thiệu, logo hoặc có dấu hiệu khác địa điểm. Trên trang chi tiết, nút **Nguồn ảnh** mở liên kết đối chiếu. Ảnh đầu trang lấy từ [Daniel Gomez](https://unsplash.com/photos/GmkIC2N8lwE).

CSV chưa có bảng giá hoặc danh sách sân nhỏ. Chế độ thử dùng một sân thử mỗi địa điểm với giá mô phỏng 100.000 ₫/giờ. Muốn nhận đặt thực tế, thêm sân nhỏ thực tế và giá đã kiểm tra trong trang quản trị trước khi xác minh. Máy chủ thay danh bạ cũ một lần khi khởi động bản này. Đơn có sẵn giữ định danh sân gốc để xem lại lịch sử.
