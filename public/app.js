let isVerified = false;

// Gửi mã OTP
document.getElementById('btnSendOtp').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  if (!email || !email.endsWith('@gmail.com')) {
    alert('Vui lòng nhập địa chỉ Gmail hợp lệ!');
    return;
  }

  const res = await fetch('/api/otp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });

  const data = await res.json();
  if (data.success) {
    document.getElementById('otpSection').classList.remove('hidden');
    document.getElementById('otpStatus').innerText = `Mã OTP thử nghiệm là: ${data.debugOtp} (hoặc xem cửa sổ CMD)`;
    alert('Đã sinh mã OTP thành công!');
  } else {
    alert(data.message);
  }
});

// Xác thực mã OTP
document.getElementById('btnVerifyOtp').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const code = document.getElementById('otpCode').value.trim();

  if (!code || code.length !== 6) {
    alert('Vui lòng nhập đủ 6 chữ số OTP!');
    return;
  }

  const res = await fetch('/api/otp/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code })
  });

  const data = await res.json();
  if (data.success) {
    isVerified = true;
    alert('🎉 Xác thực Gmail thành công!');
    document.getElementById('otpStatus').className = 'text-xs mt-1 text-green-600 font-bold';
    document.getElementById('otpStatus').innerText = '✅ Đã xác thực thành công!';
    
    // Khóa ô Email & kích hoạt nút Đăng ký
    document.getElementById('email').readOnly = true;
    const btnSubmit = document.getElementById('btnSubmit');
    btnSubmit.disabled = false;
    btnSubmit.className = 'w-full bg-red-600 text-white py-3 px-4 rounded-md font-semibold hover:bg-red-700 transition cursor-pointer';
    btnSubmit.innerText = 'Đăng Ký Tham Gia Bốc Thăm (応募する)';
  } else {
    alert(data.message);
  }
});

// Tra cứu Postal Code
document.getElementById('btnLookup').addEventListener('click', async () => {
  const zip = document.getElementById('postalCode').value.trim();
  if (!zip || zip.length < 7) {
    alert('Vui lòng nhập đủ 7 chữ số mã bưu điện!');
    return;
  }

  try {
    const res = await fetch(`/api/postal-code/${zip}`);
    const data = await res.json();
    if (data.success) {
      document.getElementById('prefecture').value = data.prefecture;
      document.getElementById('cityAddress').value = data.city;
    } else {
      alert(data.message);
    }
  } catch (err) {
    alert('Không thể kết nối API mã bưu điện.');
  }
});

// Submit Form Đăng ký
document.getElementById('lotteryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isVerified) {
    alert('Bạn phải xác thực OTP trước khi đăng ký!');
    return;
  }

  const formData = {
    email: document.getElementById('email').value,
    kanjiName: document.getElementById('kanjiName').value,
    katakanaName: document.getElementById('katakanaName').value,
    postalCode: document.getElementById('postalCode').value,
    prefecture: document.getElementById('prefecture').value,
    cityAddress: document.getElementById('cityAddress').value,
    phone: document.getElementById('phone').value
  };

  const res = await fetch('/api/lottery/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData)
  });

  const data = await res.json();
  const resultBox = document.getElementById('resultBox');
  resultBox.classList.remove('hidden', 'bg-green-100', 'text-green-800', 'bg-red-100', 'text-red-800');

  if (data.success) {
    resultBox.classList.add('bg-green-100', 'text-green-800');
    resultBox.innerHTML = `<strong>🎉 ${data.message}</strong><br>Mã đăng ký bốc thăm của bạn: <strong>${data.entryId}</strong>`;
  } else {
    resultBox.classList.add('bg-red-100', 'text-red-800');
    resultBox.innerHTML = `<strong>❌ Lỗi:</strong> ${data.message}`;
  }
});