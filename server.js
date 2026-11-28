const fs = require('fs');
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

function buildGaTag(measurementId) {
  if (!measurementId) return '';
  return [
    '  <!-- Google tag (gtag.js) -->',
    `  <script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>`,
    '  <script>',
    '    window.dataLayer = window.dataLayer || [];',
    '    function gtag(){dataLayer.push(arguments);}',
    "    gtag('js', new Date());",
    `    gtag('config', '${measurementId}');`,
    '  </script>',
  ].join('\n');
}

function sendHtmlPage(fileName) {
  const filePath = path.join(__dirname, 'public', fileName);
  return (req, res, next) => {
    fs.readFile(filePath, 'utf8', (err, html) => {
      if (err) return next(err);
      let output = html;
      if (config.gaMeasurementId && /<\/head>/i.test(output)) {
        const gaTag = buildGaTag(config.gaMeasurementId);
        output = output.replace(/<\/head>/i, `${gaTag}\n</head>`);
      }
      res.type('html').send(output);
    });
  };
}

// 画面ルーティング（静的配信より先に処理し、全HTMLページの <head> へGA4タグを動的挿入）
app.get(['/', '/index.html'], sendHtmlPage('index.html'));
app.get(['/admin', '/admin.html'], sendHtmlPage('admin.html'));

// 静的ファイル配信（HTML直配信によるバイパスを防ぐため index: false）
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ヘルスチェック（Render用）
app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    store: config.storeName,
    storageMode: db.isSupabaseMode ? 'supabase' : 'memory-demo',
    mailConfigured: config.isMailConfigured,
    gaConfigured: config.isGaConfigured,
  });
});

// APIルーティング
app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);

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
    console.log(
      ` GA4計測    : ${
        config.isGaConfigured
          ? `有効 (${config.gaMeasurementId})`
          : '無効（GA_MEASUREMENT_ID 未設定）'
      }`
    );
    if (config.isDefaultAdminPassword) {
      console.log(' [注意] ADMIN_PASSWORD が未設定のためデフォルトパスワード (admin1234) が使用されています。');
    }
    console.log('====================================================');
  });
}

module.exports = app;
