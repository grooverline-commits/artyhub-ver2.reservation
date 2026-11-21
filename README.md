# ARTYHUB 長野 ワークショップ体験予約システム (Ver2)

Googleカレンダー連携を使用せず、**Node.js + Express / Supabase / Render** のみで完結するワークショップ体験予約システムです。
店舗名や通知先メールアドレスは環境変数で差し替えられるため、長野店でのテスト運用後、新潟店など他店舗への展開もスムーズに行えます。

## フォルダ構成

```text
v2-artyhub-yoyaku/
├── package.json
├── .env.example
├── render.yaml          # Render デプロイ定義
├── schema.sql           # Supabase SQL Editor 用マイグレーションSQL
├── server.js            # Express エントリーポイント
├── src/
│   ├── config.js        # 環境変数・定数（7時間帯など）
│   ├── auth.js          # 管理画面パスワード認証・セッション検証
│   ├── db.js            # Supabase DB & Storage アクセス層（ローカルデモモード付き）
│   ├── mailer.js        # Nodemailer (Gmail SMTP) 自動メール送信
│   ├── availability.js  # 空き状況・残組数計算ロジック
│   └── routes/
│       ├── public.js    # お客様向け API
│       └── admin.js     # 管理画面 API
└── public/
    ├── index.html       # お客様向け予約画面 (/)
    ├── admin.html       # 店舗管理画面 (/admin)
    ├── css/
    │   ├── style.css
    │   └── admin.css
    └── js/
        ├── app.js
        └── admin.js
```

## セットアップ手順

### 1. Supabase の準備
1. [Supabase](https://supabase.com/) でプロジェクトを作成します。
2. ダッシュボードの **SQL Editor** を開き、`schema.sql` の内容をすべて貼り付けて **Run** を実行します。
   - `contents`, `daily_schedules`, `reservations`, `external_links` の4テーブルと、画像用 Storage バケット `content-images` が作成されます。
3. **Settings > API** から以下を控えます。
   - Project URL → `SUPABASE_URL`
   - `service_role` secret key（または anon key）→ `SUPABASE_KEY`

### 2. ローカル起動
```bash
npm install
cp .env.example .env
# .env に各種環境変数を設定（未設定でもローカルデモモードで動作確認可能です）
npm start
```
- お客様向け画面: `http://localhost:3000/`
- 管理画面: `http://localhost:3000/admin`（`.env` 未設定時の仮パスワード: `admin1234`）

### 3. Render へのデプロイ
1. 本リポジトリを GitHub へプッシュします。
2. Render ダッシュボードで **New > Web Service**（または Blueprint で `render.yaml` を読み込み）を作成します。
3. Environment Variables に以下を設定します。
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
   - `ADMIN_PASSWORD`
   - `GMAIL_USER`（例: `artyhub.info@gmail.com`）
   - `GMAIL_PASS`（Googleアカウントのアプリパスワード）
   - `STORE_NAME`（任意・デフォルト `ARTYHUB 長野`。新潟店では `ARTYHUB 新潟` に変更）
   - `STORE_NOTIFY_EMAIL`（任意・デフォルト `artyhub.info@gmail.com`）

※ `GMAIL_USER` / `GMAIL_PASS` が未設定でもアプリはエラー終了せず、メール送信のみ安全にスキップしてログ出力します。
