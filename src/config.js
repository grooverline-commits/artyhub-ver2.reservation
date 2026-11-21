require('dotenv').config();

const TIME_SLOTS = ['10:00', '11:30', '13:00', '14:30', '16:00', '17:30', '19:00'];
const RESERVATION_STATUSES = ['未対応', '確定', '来店済', 'キャンセル'];

const rawSupabaseUrl = (process.env.SUPABASE_URL || '').trim();
const rawSupabaseKey = (process.env.SUPABASE_KEY || '').trim();

const isPlaceholder = (val) =>
  !val ||
  val.includes('your-project-id') ||
  val.includes('your-supabase') ||
  val === 'changeme';

const config = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  storeName: (process.env.STORE_NAME || 'ARTYHUB 長野').trim(),
  storeNotifyEmail: (process.env.STORE_NOTIFY_EMAIL || 'artyhub.info@gmail.com').trim(),
  supabaseUrl: rawSupabaseUrl,
  supabaseKey: rawSupabaseKey,
  supabaseStorageBucket: (process.env.SUPABASE_STORAGE_BUCKET || 'content-images').trim(),
  adminPassword: (process.env.ADMIN_PASSWORD || '').trim() || 'admin1234',
  isDefaultAdminPassword: !(process.env.ADMIN_PASSWORD || '').trim(),
  gmailUser: (process.env.GMAIL_USER || '').trim(),
  gmailPass: (process.env.GMAIL_PASS || '').trim(),
  TIME_SLOTS,
  RESERVATION_STATUSES,
  isSupabaseConfigured: !isPlaceholder(rawSupabaseUrl) && !isPlaceholder(rawSupabaseKey),
  isMailConfigured:
    Boolean((process.env.GMAIL_USER || '').trim()) &&
    Boolean((process.env.GMAIL_PASS || '').trim()) &&
    !(process.env.GMAIL_PASS || '').includes('your-gmail-app-password'),
};

module.exports = config;
