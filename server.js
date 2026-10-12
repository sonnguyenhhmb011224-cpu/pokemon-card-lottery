import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import nodemailer from 'nodemailer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Cấu hình Nodemailer gửi Email
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'your-email@gmail.com',
    pass: 'your-app-password'
  }
});

// Kết nối Database SQLite
const db = new sqlite3.Database('./lottery.db', (err) => {
  if (err) console.error('Lỗi SQLite:', err.message);
  else console.log('✅ Đã kết nối cơ sở dữ liệu SQLite (lottery.db)');
});

// Khởi tạo Bảng dữ liệu
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      is_email_verified INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      email TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE,
      kanji_name TEXT NOT NULL,
      katakana_name TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      prefecture TEXT NOT NULL,
      city_address TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS lottery_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_code TEXT UNIQUE NOT NULL,
      campaign_id INTEGER DEFAULT 1,
      user_id INTEGER,
      ip_address TEXT,
      status TEXT DEFAULT 'PENDING',
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);
});

// --- API XÁC THỰC & ĐĂNG KÝ ---

// Send OTP
app.post('/api/otp/send', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.endsWith('@gmail.com')) {
    return res.status(400).json({ success: false, message: 'Chỉ chấp nhận địa chỉ Gmail!' });
  }

  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 5 * 60 * 1000;

  db.run(
    `INSERT INTO otp_codes (email, code, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at`,
    [email, otpCode, expiresAt],
    (err) => {
      if (err) return res.status(500).json({ success: false, message: 'Lỗi tạo mã OTP.' });
      console.log(`🔑 Mã OTP thử nghiệm cho ${email} là: ${otpCode}`);
      res.json({
        success: true,
        message: 'Mã OTP đã được tạo!',
        debugOtp: otpCode
      });
    }
  );
});

// Verify OTP
app.post('/api/otp/verify', (req, res) => {
  const { email, code } = req.body;
  db.get(`SELECT * FROM otp_codes WHERE email = ?`, [email], (err, record) => {
    if (err || !record) return res.status(400).json({ success: false, message: 'Chưa yêu cầu mã OTP!' });
    if (Date.now() > record.expires_at) return res.status(400).json({ success: false, message: 'Mã OTP đã hết hạn!' });
    if (record.code !== code) return res.status(400).json({ success: false, message: 'Mã OTP không chính xác!' });

    db.run(`INSERT INTO users (email, is_email_verified) VALUES (?, 1) ON CONFLICT(email) DO UPDATE SET is_email_verified=1`, [email], (err) => {
      if (err) return res.status(500).json({ success: false, message: 'Lỗi xác thực tài khoản.' });
      res.json({ success: true, message: 'Xác thực Gmail thành công!' });
    });
  });
});

// Postal Code lookup
app.get('/api/postal-code/:zip', async (req, res) => {
  const zip = req.params.zip.replace('-', '');
  try {
    const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
    const data = await response.json();
    if (data.results) {
      res.json({ success: true, prefecture: data.results[0].address1, city: data.results[0].address2 + data.results[0].address3 });
    } else {
      res.status(404).json({ success: false, message: 'Không tìm thấy mã bưu điện!' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
});

// User Apply
app.post('/api/lottery/apply', (req, res) => {
  const { email, kanjiName, katakanaName, postalCode, prefecture, cityAddress, phone } = req.body;
  const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  db.get(`SELECT * FROM users WHERE email = ? AND is_email_verified = 1`, [email], (err, user) => {
    if (err || !user) {
      return res.status(400).json({ success: false, message: 'Vui lòng xác thực mã OTP Gmail trước khi đăng ký!' });
    }

    const userId = user.id;

    db.get(`SELECT id FROM lottery_entries WHERE user_id = ? AND campaign_id = 1`, [userId], (err, existingEntry) => {
      if (existingEntry) {
        return res.status(400).json({ success: false, message: 'Gmail này đã đăng ký bốc thăm đợt này rồi!' });
      }

      db.run(
        `INSERT INTO user_profiles (user_id, kanji_name, katakana_name, postal_code, prefecture, city_address, phone_number)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET kanji_name=excluded.kanji_name, katakana_name=excluded.katakana_name, postal_code=excluded.postal_code, prefecture=excluded.prefecture, city_address=excluded.city_address, phone_number=excluded.phone_number`,
        [userId, kanjiName, katakanaName, postalCode, prefecture, cityAddress, phone],
        (err) => {
          if (err) return res.status(500).json({ success: false, message: 'Lỗi lưu thông tin cá nhân.' });

          const entryCode = 'ENT-' + Math.floor(100000 + Math.random() * 900000);
          db.run(
            `INSERT INTO lottery_entries (entry_code, campaign_id, user_id, ip_address, status) VALUES (?, 1, ?, ?, 'PENDING')`,
            [entryCode, userId, ipAddress],
            (err) => {
              if (err) return res.status(500).json({ success: false, message: 'Lỗi tạo mã dự thưởng.' });

              res.json({
                success: true,
                message: 'Đăng ký tham gia bốc thăm thành công!',
                entryId: entryCode
              });
            }
          );
        }
      );
    });
  });
});

// API Tra cứu kết quả cho người dùng
app.post('/api/lottery/check-result', (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập Email hoặc Mã dự thưởng!' });
  }

  const sql = `
    SELECT e.entry_code, u.email, e.status, e.applied_at
    FROM lottery_entries e
    JOIN users u ON e.user_id = u.id
    WHERE u.email = ? OR e.entry_code = ?
  `;

  db.get(sql, [query, query], (err, row) => {
    if (err || !row) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin đăng ký bốc thăm!' });
    }
    res.json({ success: true, data: row });
  });
});

// API Thống kê Realtime cho Landing Page
app.get('/api/landing/stats', (req, res) => {
  const statsQuery = `
    SELECT 
      COUNT(*) as totalEntries,
      SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) as wonEntries
    FROM lottery_entries
  `;

  const recentQuery = `
    SELECT 
      e.entry_code,
      u.email,
      p.prefecture,
      p.city_address,
      e.applied_at
    FROM lottery_entries e
    JOIN users u ON e.user_id = u.id
    LEFT JOIN user_profiles p ON u.id = p.user_id
    ORDER BY e.applied_at DESC
    LIMIT 5
  `;

  db.get(statsQuery, [], (err, stats) => {
    if (err) return res.status(500).json({ success: false });

    db.all(recentQuery, [], (err, recentRows) => {
      if (err) return res.status(500).json({ success: false });

      const formattedRecent = recentRows.map(r => {
        const parts = r.email.split('@');
        const maskedEmail = parts[0].substring(0, 4) + '****@' + parts[1];
        return {
          entryCode: r.entry_code,
          maskedEmail: maskedEmail,
          location: `${r.prefecture || ''} ${r.city_address || ''}`.trim() || 'Nhật Bản',
          appliedAt: r.applied_at
        };
      });

      res.json({
        success: true,
        stats: {
          totalEntries: stats ? stats.totalEntries : 0,
          wonEntries: stats ? stats.wonEntries : 0,
          quota: 50
        },
        recentEntries: formattedRecent
      });
    });
  });
});

// API Admin
app.get('/api/admin/entries', (req, res) => {
  const query = `
    SELECT 
      e.entry_code,
      u.email,
      p.kanji_name,
      p.katakana_name,
      p.postal_code,
      p.prefecture,
      p.city_address,
      p.phone_number,
      e.status,
      e.applied_at
    FROM lottery_entries e
    JOIN users u ON e.user_id = u.id
    LEFT JOIN user_profiles p ON u.id = p.user_id
    ORDER BY e.applied_at DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Lỗi truy vấn danh sách.' });
    res.json({ success: true, data: rows });
  });
});

app.post('/api/admin/update-status', (req, res) => {
  const { entryCode, status } = req.body;
  if (!['PENDING', 'WON', 'LOST'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Trạng thái không hợp lệ!' });
  }

  db.run(`UPDATE lottery_entries SET status = ? WHERE entry_code = ?`, [status, entryCode], function(err) {
    if (err) return res.status(500).json({ success: false, message: 'Lỗi cập nhật trạng thái.' });
    res.json({ success: true, message: `Đã cập nhật mã ${entryCode} thành ${status}` });
  });
});

app.get('/api/admin/export-csv', (req, res) => {
  const query = `
    SELECT 
      e.entry_code,
      u.email,
      p.kanji_name,
      p.katakana_name,
      p.postal_code,
      p.prefecture,
      p.city_address,
      p.phone_number,
      e.status,
      e.applied_at
    FROM lottery_entries e
    JOIN users u ON e.user_id = u.id
    LEFT JOIN user_profiles p ON u.id = p.user_id
    ORDER BY e.applied_at DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).send('Lỗi xuất file');

    let csvContent = '\uFEFF';
    csvContent += 'Mã Dự Thưởng (応募コード),Email,Họ Tên (氏名),Furigana (フリガナ),Mã Bưu Điện (郵便番号),Tỉnh/Thành (都道府県),Địa Chỉ (住所),Số Điện Thoại (電話番号),Trạng Thái (ステータス),Ngày Đăng Ký (応募日時)\n';

    rows.forEach(r => {
      csvContent += `"${r.entry_code}","${r.email}","${r.kanji_name || ''}","${r.katakana_name || ''}","${r.postal_code || ''}","${r.prefecture || ''}","${r.city_address || ''}","${r.phone_number || ''}","${r.status}","${r.applied_at}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=pokemon_lottery_entries.csv');
    res.status(200).send(csvContent);
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server Vibe Coding đang chạy tại: http://localhost:${PORT}`);
});