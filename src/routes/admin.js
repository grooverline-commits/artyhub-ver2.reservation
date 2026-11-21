const express = require('express');
const multer = require('multer');
const config = require('../config');
const auth = require('../auth');
const db = require('../db');
const mailer = require('../mailer');
const {
  isValidDateString,
  isValidTimeString,
  normalizeTimeSlots,
  computeDayAvailability,
} = require('../availability');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('JPG / PNG / WebP / GIF 形式の画像のみアップロードできます。'));
    }
  },
});

// ============================================================================
// 認証API
// ============================================================================
router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!auth.verifyPassword(password)) {
    return res.status(401).json({ error: 'パスワードが正しくありません。' });
  }

  const token = auth.createSessionToken();
  const isProd = config.nodeEnv === 'production';

  res.cookie(auth.COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: auth.TOKEN_TTL_MS,
    path: '/',
  });

  return res.json({
    authenticated: true,
    token,
  });
});

router.post('/logout', (req, res) => {
  res.clearCookie(auth.COOKIE_NAME, { path: '/' });
  return res.json({ authenticated: false });
});

router.get('/session', (req, res) => {
  const token = auth.extractToken(req);
  const authenticated = auth.verifySessionToken(token);
  res.json({
    authenticated,
    storeName: config.storeName,
    storeNotifyEmail: config.storeNotifyEmail,
    timeSlots: config.TIME_SLOTS,
    statuses: config.RESERVATION_STATUSES,
    isSupabaseMode: db.isSupabaseMode,
    isMailConfigured: config.isMailConfigured,
  });
});

// 以降はすべて管理者認証必須
router.use(auth.requireAdmin);

// ============================================================================
// 1. 予約管理API
// ============================================================================
router.get('/reservations', async (req, res, next) => {
  try {
    const { year, month, status, contentId } = req.query;
    let fromDate;
    let toDate;

    if (year && month) {
      const y = Number(year);
      const m = Number(month);
      if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
        return res.status(400).json({ error: '有効な年月を指定してください。' });
      }
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      fromDate = `${y}-${String(m).padStart(2, '0')}-01`;
      toDate = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    }

    const [reservations, contents] = await Promise.all([
      db.listReservations({
        fromDate,
        toDate,
        contentId: contentId || undefined,
        status: status && config.RESERVATION_STATUSES.includes(status) ? status : undefined,
      }),
      db.listContents({ activeOnly: false }),
    ]);

    const contentMap = new Map(contents.map((c) => [c.id, c]));
    const enriched = reservations.map((r) => {
      const c = contentMap.get(r.content_id);
      return {
        ...r,
        content_title: c ? c.title : r.content_title || '（削除済み商材）',
      };
    });

    res.json({ reservations: enriched });
  } catch (err) {
    next(err);
  }
});

router.patch('/reservations/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, sendConfirmationEmail, sendCancellationEmail } = req.body || {};

    if (!config.RESERVATION_STATUSES.includes(status)) {
      return res.status(400).json({ error: '不正なステータスです。' });
    }

    const existing = await db.getReservationById(id);
    if (!existing) {
      return res.status(404).json({ error: '対象の予約が見つかりません。' });
    }

    const updated = await db.updateReservationStatus(id, status);
    const content = existing.content_id ? await db.getContentById(existing.content_id) : null;

    let mailResult = null;
    const shouldSendConfirm =
      status === '確定' &&
      (sendConfirmationEmail === true || existing.status !== '確定');
    const shouldSendCancel =
      status === 'キャンセル' &&
      (sendCancellationEmail === true || existing.status !== 'キャンセル');

    if (shouldSendConfirm && updated.customer_email) {
      mailResult = await mailer.sendCustomerConfirmedEmail(updated, content);
    } else if (shouldSendCancel && updated.customer_email) {
      mailResult = await mailer.sendCustomerCancelledEmail(updated, content);
    }

    res.json({
      reservation: {
        ...updated,
        content_title: content ? content.title : updated.content_title || '（削除済み商材）',
      },
      mail: mailResult,
    });
  } catch (err) {
    next(err);
  }
});

// 管理画面用：指定商材・日付の時間帯＆空き状況取得（満席確認・強制追加UI用）
router.get('/availability/day', async (req, res, next) => {
  try {
    const { contentId, date, excludeReservationId } = req.query;
    if (!contentId || !isValidDateString(date)) {
      return res.status(400).json({ error: '有効な商材IDと日付（YYYY-MM-DD）を指定してください。' });
    }

    const content = await db.getContentById(contentId);
    if (!content) {
      return res.status(404).json({ error: '商材が見つかりません。' });
    }

    const [dailySchedule, reservationsRaw] = await Promise.all([
      db.getDailySchedule(content.id, date),
      db.listReservations({ fromDate: date, toDate: date }),
    ]);

    const reservationsForDay = excludeReservationId
      ? reservationsRaw.filter((r) => r.id !== excludeReservationId)
      : reservationsRaw;

    // 管理者向けは過去日でも空き計算を確認できるよう todayJST を 0000-01-01 として算出
    const dayInfo = computeDayAvailability({
      content,
      targetDate: date,
      dailySchedule,
      reservationsForDay,
      todayJST: '0000-01-01',
    });

    res.json({
      content: {
        id: content.id,
        title: content.title,
        price: content.price,
        min_people_per_group: Number(content.min_people_per_group) || 1,
        max_people_per_group: content.max_people_per_group,
      },
      ...dayInfo,
    });
  } catch (err) {
    next(err);
  }
});

async function validateAdminReservationPayload(body) {
  const {
    content_id,
    reservation_date,
    time_slot,
    customer_name,
    customer_email,
    customer_phone,
    people_count,
    status,
    notes,
  } = body || {};

  if (!content_id) {
    return { error: '体験メニューを選択してください。' };
  }
  const content = await db.getContentById(content_id);
  if (!content) {
    return { error: '選択された体験メニューが見つかりません。' };
  }

  if (!isValidDateString(reservation_date)) {
    return { error: '有効な予約日（YYYY-MM-DD）を指定してください。' };
  }

  const trimmedTime = String(time_slot || '').trim();
  if (!isValidTimeString(trimmedTime)) {
    return { error: '有効な時間帯（HH:MM形式）を入力してください。' };
  }

  const trimmedName = String(customer_name || '').trim();
  const trimmedEmail = String(customer_email || '').trim();
  const trimmedPhone = String(customer_phone || '').trim();
  const trimmedNotes = String(notes || '').trim().slice(0, 1000);
  const peopleNum = Number(people_count);
  const targetStatus = status && config.RESERVATION_STATUSES.includes(status) ? status : '確定';

  if (!trimmedName || trimmedName.length > 100) {
    return { error: 'お客様名を1〜100文字で入力してください。' };
  }
  if (trimmedEmail && !EMAIL_REGEX.test(trimmedEmail)) {
    return { error: 'メールアドレスの形式が正しくありません（空欄可）。' };
  }
  if (!trimmedPhone || trimmedPhone.length < 4 || trimmedPhone.length > 30) {
    return { error: 'お電話番号を入力してください。' };
  }
  if (!Number.isInteger(peopleNum) || peopleNum < 1 || peopleNum > 100) {
    return { error: '参加人数は1〜100名の整数で入力してください。' };
  }

  return {
    content,
    data: {
      content_id: content.id,
      content_title: content.title,
      reservation_date,
      time_slot: trimmedTime,
      customer_name: trimmedName,
      customer_email: trimmedEmail,
      customer_phone: trimmedPhone,
      people_count: peopleNum,
      total_price: content.price * peopleNum,
      status: targetStatus,
      notes: trimmedNotes,
    },
  };
}

// 管理者による手動予約追加（電話予約・満席時の強制追加に対応）
router.post('/reservations', async (req, res, next) => {
  try {
    const { content, data, error } = await validateAdminReservationPayload(req.body);
    if (error) return res.status(400).json({ error });

    // 空き状況を確認（全商材合算。満席でも管理者権限で強制登録を許可し、フラグのみ返す）
    const [dailySchedule, reservationsForDay] = await Promise.all([
      db.getDailySchedule(content.id, data.reservation_date),
      db.listReservations({
        fromDate: data.reservation_date,
        toDate: data.reservation_date,
      }),
    ]);
    const dayInfo = computeDayAvailability({
      content,
      targetDate: data.reservation_date,
      dailySchedule,
      reservationsForDay,
      todayJST: '0000-01-01',
    });
    const matchedSlot = dayInfo.slots.find((s) => s.time === data.time_slot);
    const wasOverbooked = !matchedSlot || matchedSlot.remaining_groups <= 0;

    const created = await db.createReservation(data);

    let mailResult = null;
    if (req.body?.sendConfirmationEmail === true && created.customer_email && created.status === '確定') {
      mailResult = await mailer.sendCustomerConfirmedEmail(created, content);
    }

    res.status(201).json({
      reservation: {
        ...created,
        content_title: content.title,
      },
      wasOverbooked,
      mail: mailResult,
    });
  } catch (err) {
    next(err);
  }
});

// 管理者による既存予約の編集（日時・商材・時間帯・人数・顧客情報・備考・ステータス）
router.put('/reservations/:id', async (req, res, next) => {
  try {
    const existing = await db.getReservationById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: '対象の予約が見つかりません。' });
    }

    const { content, data, error } = await validateAdminReservationPayload(req.body);
    if (error) return res.status(400).json({ error });

    const updated = await db.updateReservation(existing.id, data);

    let mailResult = null;
    if (existing.status !== updated.status && updated.customer_email) {
      if (updated.status === '確定') {
        mailResult = await mailer.sendCustomerConfirmedEmail(updated, content);
      } else if (updated.status === 'キャンセル') {
        mailResult = await mailer.sendCustomerCancelledEmail(updated, content);
      }
    }

    res.json({
      reservation: {
        ...updated,
        content_title: content.title,
      },
      mail: mailResult,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 2. 商材（コンテンツ）管理API
// ============================================================================
function validateContentPayload(body) {
  const title = String(body?.title || '').trim();
  const image_url = String(body?.image_url || '').trim();
  const price = Number(body?.price);
  const min_people_per_group =
    body?.min_people_per_group === undefined || body?.min_people_per_group === ''
      ? 1
      : Number(body.min_people_per_group);
  const max_people_per_group = Number(body?.max_people_per_group);
  const description = String(body?.description || '').trim();
  const is_active = body?.is_active !== false;
  const sort_order = Number.isFinite(Number(body?.sort_order)) ? Number(body.sort_order) : 0;
  const default_time_slots = normalizeTimeSlots(body?.default_time_slots);

  if (!title || title.length > 120) {
    return { error: '題名を1〜120文字で入力してください。' };
  }
  if (!Number.isInteger(price) || price < 0) {
    return { error: '金額は0以上の整数で入力してください。' };
  }
  if (!Number.isInteger(min_people_per_group) || min_people_per_group < 1 || min_people_per_group > 50) {
    return { error: '1組あたり最低人数は1〜50名の整数で入力してください。' };
  }
  if (!Number.isInteger(max_people_per_group) || max_people_per_group < 1 || max_people_per_group > 50) {
    return { error: '1組あたり上限人数は1〜50名の整数で入力してください。' };
  }
  if (min_people_per_group > max_people_per_group) {
    return { error: '1組あたり最低人数は上限人数以下で入力してください。' };
  }
  if (description.length > 500) {
    return { error: '体験内容は500文字以内で入力してください。' };
  }
  if (image_url && !/^(https?:\/\/|\/uploads\/)/i.test(image_url)) {
    return { error: '写真URLは http:// または https:// で始まるURLを指定してください。' };
  }

  return {
    data: {
      title,
      image_url,
      price,
      min_people_per_group,
      max_people_per_group,
      description,
      default_time_slots,
      is_active,
      sort_order,
    },
  };
}

router.get('/contents', async (req, res, next) => {
  try {
    const contents = await db.listContents({ activeOnly: false });
    res.json({ contents });
  } catch (err) {
    next(err);
  }
});

router.post('/contents', async (req, res, next) => {
  try {
    const { data, error } = validateContentPayload(req.body);
    if (error) return res.status(400).json({ error });
    const created = await db.createContent(data);
    res.status(201).json({ content: created });
  } catch (err) {
    next(err);
  }
});

router.put('/contents/:id', async (req, res, next) => {
  try {
    const { data, error } = validateContentPayload(req.body);
    if (error) return res.status(400).json({ error });
    const updated = await db.updateContent(req.params.id, data);
    if (!updated) {
      return res.status(404).json({ error: '対象の商材が見つかりません。' });
    }
    res.json({ content: updated });
  } catch (err) {
    next(err);
  }
});

router.delete('/contents/:id', async (req, res, next) => {
  try {
    const ok = await db.deleteContent(req.params.id);
    if (!ok) {
      return res.status(404).json({ error: '対象の商材が見つかりません。' });
    }
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// 画像アップロード（Supabase Storage）
router.post('/upload', (req, res, next) => {
  upload.single('image')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || '画像のアップロードに失敗しました。' });
    }
    if (!req.file) {
      return res.status(400).json({ error: '画像ファイルを選択してください。' });
    }
    try {
      const result = await db.uploadImage({
        buffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
      });
      res.status(201).json(result);
    } catch (uploadErr) {
      next(uploadErr);
    }
  });
});

// ============================================================================
// 3. 日別の予約枠変更API
// ============================================================================
router.get('/daily-schedules', async (req, res, next) => {
  try {
    const { contentId, fromDate, toDate } = req.query;
    const [schedules, contents] = await Promise.all([
      db.listDailySchedules({
        contentId: contentId || undefined,
        fromDate: isValidDateString(fromDate) ? fromDate : undefined,
        toDate: isValidDateString(toDate) ? toDate : undefined,
      }),
      db.listContents({ activeOnly: false }),
    ]);

    const contentMap = new Map(contents.map((c) => [c.id, c.title]));
    res.json({
      schedules: schedules.map((s) => ({
        ...s,
        content_title: contentMap.get(s.content_id) || '（削除済み商材）',
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/daily-schedules/detail', async (req, res, next) => {
  try {
    const { contentId, date } = req.query;
    if (!contentId || !isValidDateString(date)) {
      return res.status(400).json({ error: '有効な商材と日付（YYYY-MM-DD）を指定してください。' });
    }

    const content = await db.getContentById(contentId);
    if (!content) {
      return res.status(404).json({ error: '商材が見つかりません。' });
    }

    const [schedule, reservations] = await Promise.all([
      db.getDailySchedule(contentId, date),
      db.listReservations({ fromDate: date, toDate: date }),
    ]);

    const bookedByTime = {};
    for (const r of reservations) {
      if (r.status === 'キャンセル') continue;
      bookedByTime[r.time_slot] = (bookedByTime[r.time_slot] || 0) + 1;
    }

    res.json({
      content_id: content.id,
      content_title: content.title,
      target_date: date,
      has_override: Boolean(schedule),
      default_time_slots: content.default_time_slots,
      custom_time_slots: schedule ? schedule.custom_time_slots : null,
      booked_by_time: bookedByTime,
    });
  } catch (err) {
    next(err);
  }
});

router.put('/daily-schedules', async (req, res, next) => {
  try {
    const { content_id, target_date, custom_time_slots } = req.body || {};
    if (!content_id || !isValidDateString(target_date)) {
      return res.status(400).json({ error: '商材と有効な日付（YYYY-MM-DD）を指定してください。' });
    }

    const content = await db.getContentById(content_id);
    if (!content) {
      return res.status(404).json({ error: '対象の商材が見つかりません。' });
    }

    const normalized = Array.isArray(custom_time_slots)
      ? normalizeTimeSlots(custom_time_slots)
      : [];

    const saved = await db.upsertDailySchedule(content_id, target_date, normalized);
    res.json({ schedule: saved });
  } catch (err) {
    next(err);
  }
});

router.delete('/daily-schedules', async (req, res, next) => {
  try {
    const { contentId, date } = req.query;
    if (!contentId || !isValidDateString(date)) {
      return res.status(400).json({ error: '商材IDと日付を指定してください。' });
    }
    await db.deleteDailySchedule(contentId, date);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 4. SNS・外部リンク管理API
// ============================================================================
function validateLinkPayload(body) {
  const title = String(body?.title || '').trim();
  const url = String(body?.url || '').trim();
  const description = String(body?.description || '').trim();
  const sort_order = Number.isFinite(Number(body?.sort_order)) ? Number(body.sort_order) : 0;

  if (!title || title.length > 80) {
    return { error: '題名を1〜80文字で入力してください。' };
  }
  if (!/^https?:\/\/.+/i.test(url)) {
    return { error: 'URLは http:// または https:// から始まる形式で入力してください。' };
  }
  if (description.length > 300) {
    return { error: '紹介文は300文字以内で入力してください。' };
  }

  return { data: { title, url, description, sort_order } };
}

router.get('/links', async (req, res, next) => {
  try {
    const links = await db.listExternalLinks();
    res.json({ links });
  } catch (err) {
    next(err);
  }
});

router.post('/links', async (req, res, next) => {
  try {
    const { data, error } = validateLinkPayload(req.body);
    if (error) return res.status(400).json({ error });
    const created = await db.createExternalLink(data);
    res.status(201).json({ link: created });
  } catch (err) {
    next(err);
  }
});

router.put('/links/:id', async (req, res, next) => {
  try {
    const { data, error } = validateLinkPayload(req.body);
    if (error) return res.status(400).json({ error });
    const updated = await db.updateExternalLink(req.params.id, data);
    if (!updated) {
      return res.status(404).json({ error: '対象のリンクが見つかりません。' });
    }
    res.json({ link: updated });
  } catch (err) {
    next(err);
  }
});

router.delete('/links/:id', async (req, res, next) => {
  try {
    const ok = await db.deleteExternalLink(req.params.id);
    if (!ok) {
      return res.status(404).json({ error: '対象のリンクが見つかりません。' });
    }
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
