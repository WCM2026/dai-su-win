// api.js — gọi backend Apps Script từ domain khác (GitHub Pages)
// CẬP NHẬT URL này thành URL Web App đã deploy (Deploy > Manage deployments > copy URL)
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbz-489WtsNWSWfgGsb6muXqlzjmDSc2XD4pnCdSgau7b2N3RMEolnIgeSA1uPL_wU83/exec';
// CẬP NHẬT URL này thành URL Google Sheet backend (mở trực tiếp để sửa hàng loạt Users / DanhMucKhoiPhong / Quarters)
const SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1RZ0-hSwBtnyt2O84xb1p8u8qcvXVLW2B-9k1fApJGZU/edit';
// Logo WinCommerce dùng chung cho tất cả các trang
const LOGO_URL = 'https://datax-talent.basecdn.net/winmart/logo.png';
// Domain email công ty được điền sẵn để người dùng chỉ cần gõ phần tên trước @
const EMAIL_DOMAIN = '@winmart.masangroup.com';

// ---- JSONP: dùng cho các lệnh ĐỌC dữ liệu (không bị giới hạn CORS vì là <script> tag) ----
let _jsonpCounter = 0;
function jsonp(action, params = {}) {
  return new Promise((resolve, reject) => {
    const cbName = `_cb_${Date.now()}_${_jsonpCounter++}`;
    window[cbName] = (data) => { resolve(data); delete window[cbName]; script.remove(); };
    const query = new URLSearchParams({ action, callback: cbName, ...params }).toString();
    const script = document.createElement('script');
    script.src = `${WEBAPP_URL}?${query}`;
    script.onerror = () => reject(new Error('Không kết nối được tới hệ thống. Kiểm tra WEBAPP_URL.'));
    document.body.appendChild(script);
  });
}

// ---- Form-POST qua iframe ẩn: dùng cho việc GHI dữ liệu lớn (nộp đề cử có ảnh) ----
// Đây là submit form thật (browser navigation) nên không bị CORS chặn, không giới hạn độ dài URL.
function postForm(fields) {
  return new Promise((resolve, reject) => {
    const frameName = `_frame_${Date.now()}`;
    const iframe = document.createElement('iframe');
    iframe.name = frameName;
    iframe.style.display = 'none';
    document.body.appendChild(iframe);

    let settled = false;
    let pollTimer = null;
    let timeoutTimer = null;

    function cleanup() {
      window.removeEventListener('message', onMessage);
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      setTimeout(() => iframe.remove(), 500);
    }
    function finish(result) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    function onMessage(e) {
      // Không kiểm tra e.origin vì response tới từ script.google.com, domain có thể thay đổi theo deployment
      finish(e.data);
    }
    window.addEventListener('message', onMessage);

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = WEBAPP_URL;
    form.target = frameName;
    Object.entries(fields).forEach(([key, value]) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = value == null ? '' : value;
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
    form.remove();

    // DỰ PHÒNG: cầu nối postMessage qua iframe ẩn đôi khi không đáng tin cậy (tùy trình duyệt/mạng),
    // dù backend đã ghi dữ liệu thành công. Nếu request có clientKey, chủ động hỏi lại server bằng
    // JSONP (kênh GET đơn giản, đã chứng minh hoạt động ổn định) để xác nhận độc lập — không cần
    // chờ postMessage nữa nếu đã xác nhận được dòng dữ liệu tồn tại.
    if (fields && fields.clientKey) {
      let attempts = 0;
      const maxAttempts = 10;
      pollTimer = setInterval(async () => {
        if (settled) return;
        attempts++;
        try {
          const res = await jsonp('checkClientKey', { clientKey: fields.clientKey });
          if (res && res.found) {
            finish({ success: true, message: 'Đã nộp đề cử thành công!' });
            return;
          }
        } catch (err) { /* bỏ qua, thử lại ở lần poll kế tiếp */ }
        if (attempts >= maxAttempts) clearInterval(pollTimer);
      }, 4000);
    }

    timeoutTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Hết thời gian chờ phản hồi từ hệ thống.'));
    }, 90000);
  });
}

// Nén ảnh phía trình duyệt trước khi gửi — giới hạn kích thước để tránh request quá nặng,
// nhưng vẫn giữ đủ độ phân giải để in poster (mặc định 1600px cạnh dài, chất lượng 88%)
function compressImage(file, maxDimension = 1600, quality = 0.88) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const scale = maxDimension / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const Api = {
  // Auth
  requestOtp: (email) => jsonp('requestOtp', { email }),
  verifyOtpSetPassword: (email, otp, newPassword) => jsonp('verifyOtpSetPassword', { email, otp, newPassword }),
  login: (email, password) => jsonp('login', { email, password }),

  // Dashboard
  getData: (token, quy) => jsonp('data', { token, quy: quy || 'all' }),
  getStats: (token, quy) => jsonp('stats', { token, quy: quy || 'all' }),
  getPipeline: (token, quy) => jsonp('pipeline', { token, quy }),
  getDetail: (token, id) => jsonp('detail', { token, id }),
  decide: (token, id, approved) => jsonp('decide', { token, id, approved: approved ? 'true' : 'false' }),

  // Quarters
  getQuarters: () => jsonp('quarters'),
  getActiveQuarter: () => jsonp('activeQuarter'),
  addQuarter: (token, tenQuy, hanB1, hanB2, hanB3) => jsonp('addQuarter', { token, tenQuy, hanB1, hanB2, hanB3 }),
  removeQuarter: (token, maQuy) => jsonp('removeQuarter', { token, maQuy }),
  setActiveQuarter: (token, maQuy) => jsonp('setActiveQuarter', { token, maQuy }),

  // Users / phân quyền HRBP
  listUsers: (token) => jsonp('listUsers', { token }),
  addUser: (token, email, hoTen, role, phamVi) => jsonp('addUser', { token, email, hoTen, role, phamVi }),
  removeUser: (token, email) => jsonp('removeUser', { token, email }),
  updateUserScope: (token, email, phamVi) => jsonp('updateUserScope', { token, email, phamVi }),

  // Danh mục Khối/Phòng + thống kê
  getDeptList: (loaiDonVi) => jsonp('deptList', { loaiDonVi }),
  getDeptStats: (token, quy) => jsonp('deptStats', { token, quy: quy || 'all' }),

  // Tra cứu nhân sự theo MSNV (sheet DSNS)
  lookupEmployee: (maNV, quy) => jsonp('lookupEmployee', { maNV, quy: quy || '' }),
  checkClientKey: (clientKey) => jsonp('checkClientKey', { clientKey }),

  // Export
  exportCsvUrl: (token, quy) => `${WEBAPP_URL}?action=exportCsv&token=${token}&quy=${quy || 'all'}`,

  // Nộp đề cử (form-post, không phải JSONP)
  submitNomination: (fields) => postForm(fields),
  compressImage
};

// Điền sẵn domain email công ty (@winmart.masangroup.com) vào 1 ô input email,
// đặt con trỏ ngay trước dấu @ để người dùng chỉ cần gõ phần tên đăng nhập.
function prefillEmailDomain(input) {
  if (!input) return;
  if (!input.value) input.value = EMAIL_DOMAIN;
  const placeCursor = () => {
    const at = input.value.indexOf('@');
    const pos = at === -1 ? 0 : at;
    input.setSelectionRange(pos, pos);
  };
  input.addEventListener('focus', placeCursor);
  setTimeout(placeCursor, 0);
}

// ---- Session helpers ----
const Session = {
  save(session) { localStorage.setItem('dsw_session', JSON.stringify(session)); },
  get() { try { return JSON.parse(localStorage.getItem('dsw_session')); } catch { return null; } },
  clear() { localStorage.removeItem('dsw_session'); },
  requireLogin() {
    const s = this.get();
    if (!s || !s.token) { window.location.href = 'login.html'; return null; }
    return s;
  }
};
