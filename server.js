const path = require('path');
const express = require('express');
const config = require('./src/config');
const db = require('./src/db');
const publicRoutes = require('./src/routes/public');
const adminRoutes = require('./src/routes/admin');

const app = express();

// Renderなどのリバースプロキシ配下でSecure Cookie等を正しく扱う
app.set('trust proxy', 1);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 静的ファイル配信
app.use(express.static(path.join(__dirname, 'public')));

// ヘルスチェック（Render用）
app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    store: config.storeName,
    storageMode: db.isSupabaseMode ? 'supabase' : 'memory-demo',
    mailConfigured: config.isMailConfigured,
  });
});

// APIルーティング
app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);

// 画面ルーティング
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API 404ハンドラ
app.use('/api', (req, res) => {
  res.status(404).json({ error: '指定されたAPIエンドポイントが見つかりません。' });
});

// 共通エラーハンドラ
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'サーバー内部エラーが発生しました。しばらくしてから再度お試しください。',
  });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log('====================================================');
    console.log(` ${config.storeName} ワークショップ予約システム (Ver2)`);
    console.log(` URL        : http://localhost:${config.port}`);
    console.log(` 管理画面   : http://localhost:${config.port}/admin`);
    console.log(
      ` DBモード   : ${
        db.isSupabaseMode
          ? 'Supabase 接続中'
          : 'ローカルデモモード（SUPABASE_URL/KEY 未設定のためインメモリ動作）'
      }`
    );
    console.log(
      ` メール送信 : ${
        config.isMailConfigured
          ? `有効 (${config.gmailUser} -> 通知先: ${config.storeNotifyEmail})`
          : 'スキップモード（GMAIL_USER/GMAIL_PASS 未設定）'
      }`
    );
    if (config.isDefaultAdminPassword) {
      console.log(' [注意] ADMIN_PASSWORD が未設定のためデフォルトパスワード (admin1234) が使用されています。');
    }
    console.log('====================================================');
  });
}

module.exports = app;
