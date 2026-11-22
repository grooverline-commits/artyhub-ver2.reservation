const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const { normalizeTimeSlots } = require('./availability');

const supabase = config.isSupabaseConfigured
  ? createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// ============================================================================
// ローカルテスト用インメモリDB（SUPABASE_URL / SUPABASE_KEY 未設定時のみ使用）
// ============================================================================
function createInitialMemoryState() {
  const content1Id = '11111111-1111-4111-8111-111111111111';
  const content2Id = '22222222-2222-4222-8222-222222222222';
  const now = new Date().toISOString();

  return {
    contents: [
      {
        id: content1Id,
        title: 'フルイドアート（たらし込みアート）体験',
        image_url: '',
        price: 3800,
        min_people_per_group: 1,
        max_people_per_group: 4,
        description:
          'お好みのアクリル絵の具をキャンバスに流して、世界に一つだけの抽象画を作る人気No.1のワークショップです。初心者の方でも安心して楽しめます。',
        default_time_slots: [
          { time: '10:00', max_groups: 2 },
          { time: '11:30', max_groups: 2 },
          { time: '13:00', max_groups: 2 },
          { time: '14:30', max_groups: 2 },
          { time: '16:00', max_groups: 2 },
        ],
        is_active: true,
        sort_order: 1,
        created_at: now,
        updated_at: now,
      },
      {
        id: content2Id,
        title: 'テクスチャーアート体験',
        image_url: '',
        price: 4500,
        min_people_per_group: 1,
        max_people_per_group: 4,
        description:
          'モデリングペーストとペインティングナイフで立体的なアートパネルを制作します。お部屋のインテリアにぴったりの作品をお持ち帰りいただけます。',
        default_time_slots: [
          { time: '10:00', max_groups: 2 },
          { time: '13:00', max_groups: 2 },
          { time: '16:00', max_groups: 2 },
          { time: '17:30', max_groups: 1 },
        ],
        is_active: true,
        sort_order: 2,
        created_at: now,
        updated_at: now,
      },
    ],
    daily_schedules: [],
    reservations: [],
    external_links: [
      {
        id: 'aaaa1111-1111-4111-8111-111111111111',
        title: 'Instagram',
        url: 'https://www.instagram.com/',
        description: 'お客様の素敵な作品やワークショップの雰囲気を毎日発信しています！',
        sort_order: 1,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'aaaa2222-2222-4222-8222-222222222222',
        title: 'TikTok',
        url: 'https://www.tiktok.com/',
        description: '制作風景のショート動画やアートの楽しみ方を公開中。',
        sort_order: 2,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'aaaa3333-3333-4333-8333-333333333333',
        title: 'Googleマップ（アクセス）',
        url: 'https://maps.google.com/',
        description: 'ARTYHUB 長野店へのアクセス・道順はこちらからご確認いただけます。',
        sort_order: 3,
        created_at: now,
        updated_at: now,
      },
    ],
  };
}

const mem = config.isSupabaseConfigured ? null : createInitialMemoryState();

const SUPABASE_MAX_RETRIES = 3;
const SUPABASE_RETRY_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableJwtError(error) {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  const message = String(error.message || '');
  const details = String(error.details || '');
  return (
    code === 'PGRST303' ||
    /JWT issued at future/i.test(message) ||
    /JWT issued at future/i.test(details)
  );
}

function handleSupabaseError(error, context) {
  if (!error) return;
  const err = new Error(`${context}: ${error.message}`);
  err.code = error.code;
  err.status = 500;
  throw err;
}

/**
 * Supabaseクエリ実行ラッパー
 * PGRST303 / JWT issued at future 発生時は1秒待機して最大3回まで自動リトライする
 */
async function runSupabaseWithRetry(
  queryFn,
  context,
  { maxRetries = SUPABASE_MAX_RETRIES, delayMs = SUPABASE_RETRY_DELAY_MS } = {}
) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await queryFn();
      if (!result || !result.error) {
        if (attempt > 0) {
          console.log(`[SUPABASE RETRY SUCCEEDED] ${context} (${attempt}回目のリトライで成功)`);
        }
        return result;
      }

      lastError = result.error;
      if (isRetryableJwtError(lastError) && attempt < maxRetries) {
        console.warn(
          `[SUPABASE RETRY] ${context}: ${lastError.message} (code: ${lastError.code || 'N/A'}) -> ${delayMs}ms待機後リトライ (${attempt + 1}/${maxRetries})`
        );
        await sleep(delayMs);
        continue;
      }

      handleSupabaseError(lastError, context);
    } catch (err) {
      if (isRetryableJwtError(err) && attempt < maxRetries) {
        console.warn(
          `[SUPABASE RETRY] ${context}: ${err.message} (code: ${err.code || 'N/A'}) -> ${delayMs}ms待機後リトライ (${attempt + 1}/${maxRetries})`
        );
        await sleep(delayMs);
        continue;
      }
      throw err;
    }
  }
  handleSupabaseError(lastError, context);
}

// ============================================================================
// 1. contents（商材・コンテンツ）
// ============================================================================
async function listContents({ activeOnly = false } = {}) {
  if (supabase) {
    const { data } = await runSupabaseWithRetry(() => {
      let query = supabase
        .from('contents')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (activeOnly) {
        query = query.eq('is_active', true);
      }
      return query;
    }, '商材一覧の取得に失敗しました');

    return (data || []).map((c) => ({
      ...c,
      min_people_per_group: Number(c.min_people_per_group) || 1,
      default_time_slots: normalizeTimeSlots(c.default_time_slots),
    }));
  }

  let list = [...mem.contents];
  if (activeOnly) list = list.filter((c) => c.is_active);
  list.sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  return list.map((c) => ({
    ...c,
    min_people_per_group: Number(c.min_people_per_group) || 1,
    default_time_slots: normalizeTimeSlots(c.default_time_slots),
  }));
}

async function getContentById(id) {
  if (!id) return null;
  if (supabase) {
    const { data } = await runSupabaseWithRetry(
      () => supabase.from('contents').select('*').eq('id', id).maybeSingle(),
      '商材の取得に失敗しました'
    );
    if (!data) return null;
    return {
      ...data,
      min_people_per_group: Number(data.min_people_per_group) || 1,
      default_time_slots: normalizeTimeSlots(data.default_time_slots),
    };
  }

  const found = mem.contents.find((c) => c.id === id);
  return found
    ? {
        ...found,
        min_people_per_group: Number(found.min_people_per_group) || 1,
        default_time_slots: normalizeTimeSlots(found.default_time_slots),
      }
    : null;
}

async function createContent(payload) {
  const record = {
    title: payload.title,
    image_url: payload.image_url || '',
    price: Number(payload.price),
    min_people_per_group: Number(payload.min_people_per_group) || 1,
    max_people_per_group: Number(payload.max_people_per_group),
    description: payload.description || '',
    default_time_slots: normalizeTimeSlots(payload.default_time_slots),
    is_active: payload.is_active !== false,
    sort_order: Number(payload.sort_order) || 0,
  };

  if (supabase) {
    const { data } = await runSupabaseWithRetry(
      () => supabase.from('contents').insert(record).select().single(),
      '商材の作成に失敗しました'
    );
    return data;
  }

  const now = new Date().toISOString();
  const item = { id: crypto.randomUUID(), ...record, created_at: now, updated_at: now };
  mem.contents.push(item);
  return item;
}

async function updateContent(id, payload) {
  const updates = {
    title: payload.title,
    image_url: payload.image_url || '',
    price: Number(payload.price),
    min_people_per_group: Number(payload.min_people_per_group) || 1,
    max_people_per_group: Number(payload.max_people_per_group),
    description: payload.description || '',
    default_time_slots: normalizeTimeSlots(payload.default_time_slots),
    is_active: payload.is_active !== false,
    sort_order: Number(payload.sort_order) || 0,
  };

  if (supabase) {
    const { data } = await runSupabaseWithRetry(
      () => supabase.from('contents').update(updates).eq('id', id).select().maybeSingle(),
      '商材の更新に失敗しました'
    );
    return data;
  }

  const idx = mem.contents.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  mem.contents[idx] = {
    ...mem.contents[idx],
    ...updates,
    updated_at: new Date().toISOString(),
  };
  return mem.contents[idx];
}

async function deleteContent(id) {
  if (supabase) {
    await runSupabaseWithRetry(
      () => supabase.from('contents').delete().eq('id', id),
      '商材の削除に失敗しました'
    );
    return true;
  }

  const idx = mem.contents.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  mem.contents.splice(idx, 1);
  mem.daily_schedules = mem.daily_schedules.filter((d) => d.content_id !== id);
  return true;
}

// ============================================================================
// 2. daily_schedules（日別の予約枠上書き設定）
// ============================================================================
async function listDailySchedules({ contentId, fromDate, toDate } = {}) {
  if (supabase) {
    const { data } = await runSupabaseWithRetry(() => {
      let query = supabase
        .from('daily_schedules')
        .select('*')
        .order('target_date', { ascending: true });
      if (contentId) query = query.eq('content_id', contentId);
      if (fromDate) query = query.gte('target_date', fromDate);
      if (toDate) query = query.lte('target_date', toDate);
      return query;
    }, '日別スケジュールの取得に失敗しました');

    return (data || []).map((d) => ({
      ...d,
      custom_time_slots: normalizeTimeSlots(d.custom_time_slots),
    }));
  }

  let list = [...mem.daily_schedules];
  if (contentId) list = list.filter((d) => d.content_id === contentId);
  if (fromDate) list = list.filter((d) => d.target_date >= fromDate);
  if (toDate) list = list.filter((d) => d.target_date <= toDate);
  list.sort((a, b) => a.target_date.localeCompare(b.target_date));
  return list.map((d) => ({
    ...d,
    custom_time_slots: normalizeTimeSlots(d.custom_time_slots),
  }));
}

async function getDailySchedule(contentId, targetDate) {
  if (supabase) {
    const { data } = await runSupabaseWithRetry(
      () =>
        supabase
          .from('daily_schedules')
          .select('*')
          .eq('content_id', contentId)
          .eq('target_date', targetDate)
          .maybeSingle(),
      '日別スケジュールの取得に失敗しました'
    );
    if (!data) return null;
    return {
      ...data,
      custom_time_slots: normalizeTimeSlots(data.custom_time_slots),
    };
  }

  const found = mem.daily_schedules.find(
    (d) => d.content_id === contentId && d.target_date === targetDate
  );
  return found
    ? { ...found, custom_time_slots: normalizeTimeSlots(found.custom_time_slots) }
    : null;
}

async function upsertDailySchedule(contentId, targetDate, customTimeSlots) {
  const normalized = normalizeTimeSlots(customTimeSlots);

  if (supabase) {
    const { data } = await runSupabaseWithRetry(
      () =>
        supabase
          .from('daily_schedules')
          .upsert(
            {
              content_id: contentId,
              target_date: targetDate,
              custom_time_slots: normalized,
            },
            { onConflict: 'content_id,target_date' }
          )
          .select()
          .single(),
      '日別スケジュールの保存に失敗しました'
    );
    return data;
  }

  const now = new Date().toISOString();
  const idx = mem.daily_schedules.findIndex(
    (d) => d.content_id === contentId && d.target_date === targetDate
  );
  if (idx !== -1) {
    mem.daily_schedules[idx] = {
      ...mem.daily_schedules[idx],
      custom_time_slots: normalized,
      updated_at: now,
    };
    return mem.daily_schedules[idx];
  }
  const item = {
    id: crypto.randomUUID(),
    content_id: contentId,
    target_date: targetDate,
    custom_time_slots: normalized,
    created_at: now,
    updated_at: now,
  };
  mem.daily_schedules.push(item);
  return item;
}

async function deleteDailySchedule(contentId, targetDate) {
  if (supabase) {
    await runSupabaseWithRetry(
      () =>
        supabase
          .from('daily_schedules')
          .delete()
          .eq('content_id', contentId)
          .eq('target_date', targetDate),
      '日別スケジュールの削除に失敗しました'
    );
    return true;
  }

  mem.daily_schedules = mem.daily_schedules.filter(
    (d) => !(d.content_id === contentId && d.target_date === targetDate)
  );
  return true;
}

// ============================================================================
// 3. reservations（予約データ）
// ============================================================================
async function listReservations({ fromDate, toDate, contentId, status } = {}) {
  if (supabase) {
    const { data } = await runSupabaseWithRetry(() => {
      let query = supabase
        .from('reservations')
        .select('*')
        .order('reservation_date', { ascending: true })
        .order('time_slot', { ascending: true })
        .order('created_at', { ascending: true });

      if (fromDate) query = query.gte('reservation_date', fromDate);
      if (toDate) query = query.lte('reservation_date', toDate);
      if (contentId) query = query.eq('content_id', contentId);
      if (status) query = query.eq('status', status);
      return query;
    }, '予約一覧の取得に失敗しました');

    return data || [];
  }

  let list = [...mem.reservations];
  if (fromDate) list = list.filter((r) => r.reservation_date >= fromDate);
  if (toDate) list = list.filter((r) => r.reservation_date <= toDate);
  if (contentId) list = list.filter((r) => r.content_id === contentId);
  if (status) list = list.filter((r) => r.status === status);

  list.sort(
    (a, b) =>
      a.reservation_date.localeCompare(b.reservation_date) ||
      a.time_slot.localeCompare(b.time_slot) ||
      a.created_at.localeCompare(b.created_at)
  );
  return list;
}

async function getReservationById(id) {
  if (!id) return null;
  if (supabase) {
    const { data } = await runSupabaseWithRetry(
      () => supabase.from('reservations').select('*').eq('id', id).maybeSingle(),
      '予約の取得に失敗しました'
    );
    return data;
  }

  return mem.reservations.find((r) => r.id === id) || null;
}

async function createReservation(payload) {
  const record = {
    content_id: payload.content_id,
    content_title: payload.content_title || '',
    reservation_date: payload.reservation_date,
    time_slot: payload.time_slot,
    customer_name: payload.customer_name,
    customer_email: payload.customer_email,
    customer_phone: payload.customer_phone,
    people_count: Number(payload.people_count),
    total_price: Number(payload.total_price),
    status: payload.status || '未対応',
    notes: payload.notes || '',
  };

  if (supabase) {
    const { data } = await runSupabaseWithRetry(
      () => supabase.from('reservations').insert(record).select().single(),
      '予約の登録に失敗しました'
    );
    return data;
  }

  const now = new Date().toISOString();
  const item = { id: crypto.randomUUID(), ...record, created_at: now, updated_at: now };
  mem.reservations.push(item);
  return item;
}

async function updateReservation(id, payload) {
  const updates = {
    content_id: payload.content_id,
    content_title: payload.content_title || '',
    reservation_date: payload.reservation_date,
    time_slot: payload.time_slot,
    customer_name: payload.customer_name,
    customer_email: payload.customer_email || '',
    customer_phone: payload.customer_phone,
    people_count: Number(payload.people_count),
    total_price: Number(payload.total_price),
    status: payload.status,
    notes: payload.notes || '',
  };

  if (supabase) {
    const { data } = await runSupabaseWithRetry(
      () => supabase.from('reservations').update(updates).eq('id', id).select().maybeSingle(),
      '予約の更新に失敗しました'
    );
    return data;
  }

  const idx = mem.reservations.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  mem.reservations[idx] = {
    ...mem.reservations[idx],
    ...updates,
    updated_at: new Date().toISOString(),
  };
  return mem.reservations[idx];
}

async function updateReservationStatus(id, status) {
  if (supabase) {
    const { data } = await runSupabaseWithRetry(
      () => supabase.from('reservations').update({ status }).eq('id', id).select().maybeSingle(),
      '予約ステータスの更新に失敗しました'
    );
    return data;
  }

  const idx = mem.reservations.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  mem.reservations[idx] = {
    ...mem.reservations[idx],
    status,
    updated_at: new Date().toISOString(),
  };
  return mem.reservations[idx];
}

// ============================================================================
// 4. external_links（SNS・外部リンク集）
// ============================================================================
async function listExternalLinks() {
  if (supabase) {
    const { data } = await runSupabaseWithRetry(
      () =>
        supabase
          .from('external_links')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true }),
      '外部リンク一覧の取得に失敗しました'
    );
    return data || [];
  }

  return [...mem.external_links].sort(
    (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)
  );
}

async function createExternalLink(payload) {
  const record = {
    title: payload.title,
    url: payload.url,
    description: payload.description || '',
    sort_order: Number(payload.sort_order) || 0,
  };

  if (supabase) {
    const { data } = await runSupabaseWithRetry(
      () => supabase.from('external_links').insert(record).select().single(),
      '外部リンクの登録に失敗しました'
    );
    return data;
  }

  const now = new Date().toISOString();
  const item = { id: crypto.randomUUID(), ...record, created_at: now, updated_at: now };
  mem.external_links.push(item);
  return item;
}

async function updateExternalLink(id, payload) {
  const updates = {
    title: payload.title,
    url: payload.url,
    description: payload.description || '',
    sort_order: Number(payload.sort_order) || 0,
  };

  if (supabase) {
    const { data } = await runSupabaseWithRetry(
      () => supabase.from('external_links').update(updates).eq('id', id).select().maybeSingle(),
      '外部リンクの更新に失敗しました'
    );
    return data;
  }

  const idx = mem.external_links.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  mem.external_links[idx] = {
    ...mem.external_links[idx],
    ...updates,
    updated_at: new Date().toISOString(),
  };
  return mem.external_links[idx];
}

async function deleteExternalLink(id) {
  if (supabase) {
    await runSupabaseWithRetry(
      () => supabase.from('external_links').delete().eq('id', id),
      '外部リンクの削除に失敗しました'
    );
    return true;
  }

  const idx = mem.external_links.findIndex((l) => l.id === id);
  if (idx === -1) return false;
  mem.external_links.splice(idx, 1);
  return true;
}

// ============================================================================
// 5. 画像アップロード（Supabase Storage / ローカルフォールバック）
// ============================================================================
function getSafeExtension(originalname, mimetype) {
  const mimeMap = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };
  if (mimeMap[mimetype]) return mimeMap[mimetype];
  const ext = path.extname(originalname || '').toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) return ext;
  return '.jpg';
}

async function uploadImage({ buffer, originalname, mimetype }) {
  const ext = getSafeExtension(originalname, mimetype);
  const fileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;

  if (supabase) {
    const filePath = `contents/${fileName}`;
    await runSupabaseWithRetry(
      () =>
        supabase.storage
          .from(config.supabaseStorageBucket)
          .upload(filePath, buffer, {
            contentType: mimetype,
            upsert: false,
          }),
      'Supabase Storageへの画像アップロードに失敗しました'
    );

    const { data } = supabase.storage
      .from(config.supabaseStorageBucket)
      .getPublicUrl(filePath);

    return { url: data.publicUrl, storage: 'supabase' };
  }

  // ローカルデモモード時は public/uploads に保存
  const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, fileName), buffer);
  return { url: `/uploads/${fileName}`, storage: 'local' };
}

module.exports = {
  isSupabaseMode: Boolean(supabase),
  isRetryableJwtError,
  runSupabaseWithRetry,
  listContents,
  getContentById,
  createContent,
  updateContent,
  deleteContent,
  listDailySchedules,
  getDailySchedule,
  upsertDailySchedule,
  deleteDailySchedule,
  listReservations,
  getReservationById,
  createReservation,
  updateReservation,
  updateReservationStatus,
  listExternalLinks,
  createExternalLink,
  updateExternalLink,
  deleteExternalLink,
  uploadImage,
};
