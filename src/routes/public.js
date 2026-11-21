const express = require('express');
const config = require('../config');
const db = require('../db');
const mailer = require('../mailer');
const {
  getTodayJST,
  isValidDateString,
  isValidTimeString,
  computeDayAvailability,
  computeMonthAvailability,
} = require('../availability');

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 店舗基本情報・定数
router.get('/config', (req, res) => {
  res.json({
    storeName: config.storeName,
    storeNotifyEmail: config.storeNotifyEmail,
    timeSlots: config.TIME_SLOTS,
    today: getTodayJST(),
  });
});

// 公開中の商材一覧
router.get('/contents', async (req, res, next) => {
  try {
    const contents = await db.listContents({ activeOnly: true });
    res.json({ contents });
  } catch (err) {
    next(err);
  }
});

// 月別空き状況（商材単位）
router.get('/availability', async (req, res, next) => {
  try {
    const { contentId } = req.query;
    const year = Number(req.query.year);
    const month = Number(req.query.month);

    if (!contentId) {
      return res.status(400).json({ error: '商材ID（contentId）を指定してください。' });
    }
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      return res.status(400).json({ error: '有効な年（year）を指定してください。' });
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: '有効な月（month）を指定してください。' });
    }

    const content = await db.getContentById(contentId);
    if (!content || !content.is_active) {
      return res.status(404).json({ error: '指定された体験メニューが見つかりません。' });
    }

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const fromDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const toDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    const [dailySchedules, reservations] = await Promise.all([
      db.listDailySchedules({ contentId: content.id, fromDate, toDate }),
      db.listReservations({ fromDate, toDate }),
    ]);

    const availability = computeMonthAvailability({
      content,
      year,
      month,
      dailySchedules,
      reservations,
    });

    res.json({
      content: {
        id: content.id,
        title: content.title,
        price: content.price,
        max_people_per_group: content.max_people_per_group,
      },
      ...availability,
    });
  } catch (err) {
    next(err);
  }
});

// 日別空き状況
router.get('/availability/day', async (req, res, next) => {
  try {
    const { contentId, date } = req.query;
    if (!contentId || !isValidDateString(date)) {
      return res.status(400).json({ error: '有効な商材IDと日付（YYYY-MM-DD）を指定してください。' });
    }

    const content = await db.getContentById(contentId);
    if (!content || !content.is_active) {
      return res.status(404).json({ error: '指定された体験メニューが見つかりません。' });
    }

    const [dailySchedule, reservationsForDay] = await Promise.all([
      db.getDailySchedule(content.id, date),
      db.listReservations({ fromDate: date, toDate: date }),
    ]);

    const dayInfo = computeDayAvailability({
      content,
      targetDate: date,
      dailySchedule,
      reservationsForDay,
    });

    res.json({
      content: {
        id: content.id,
        title: content.title,
        price: content.price,
        max_people_per_group: content.max_people_per_group,
      },
      ...dayInfo,
    });
  } catch (err) {
    next(err);
  }
});

// 新規予約登録
router.post('/reservations', async (req, res, next) => {
  try {
    const {
      content_id,
      reservation_date,
      time_slot,
      customer_name,
      customer_email,
      customer_phone,
      people_count,
      notes,
    } = req.body || {};

    // 入力バリデーション
    if (!content_id) {
      return res.status(400).json({ error: '体験メニューを選択してください。' });
    }
    if (!isValidDateString(reservation_date)) {
      return res.status(400).json({ error: '有効な予約日を選択してください。' });
    }
    if (!isValidTimeString(String(time_slot || '').trim())) {
      return res.status(400).json({ error: '有効な時間帯を選択してください。' });
    }

    const trimmedName = String(customer_name || '').trim();
    const trimmedEmail = String(customer_email || '').trim();
    const trimmedPhone = String(customer_phone || '').trim();
    const trimmedNotes = String(notes || '').trim().slice(0, 1000);
    const peopleNum = Number(people_count);

    if (!trimmedName || trimmedName.length > 100) {
      return res.status(400).json({ error: 'お名前を正しく入力してください。' });
    }
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      return res.status(400).json({ error: '有効なメールアドレスを入力してください。' });
    }
    if (!trimmedPhone || trimmedPhone.length < 6 || trimmedPhone.length > 30) {
      return res.status(400).json({ error: 'お電話番号を正しく入力してください。' });
    }

    const content = await db.getContentById(content_id);
    if (!content || !content.is_active) {
      return res.status(404).json({ error: '選択された体験メニューは現在予約を受け付けていません。' });
    }

    if (!Number.isInteger(peopleNum) || peopleNum < 1 || peopleNum > content.max_people_per_group) {
      return res.status(400).json({
        error: `参加人数は1名〜${content.max_people_per_group}名の間で選択してください。`,
      });
    }

    const todayJST = getTodayJST();
    if (reservation_date < todayJST) {
      return res.status(400).json({ error: '過去の日付は予約できません。' });
    }

    // 空き枠チェック（全商材共通で同じ日時・時間帯の残数を確認）
    const [dailySchedule, reservationsForDay] = await Promise.all([
      db.getDailySchedule(content.id, reservation_date),
      db.listReservations({
        fromDate: reservation_date,
        toDate: reservation_date,
      }),
    ]);

    const dayInfo = computeDayAvailability({
      content,
      targetDate: reservation_date,
      dailySchedule,
      reservationsForDay,
      todayJST,
    });

    const targetSlot = dayInfo.slots.find((s) => s.time === time_slot);
    if (!targetSlot) {
      return res.status(400).json({ error: '指定された時間帯は開催されていません。' });
    }
    if (!targetSlot.is_available || targetSlot.remaining_groups <= 0) {
      return res.status(409).json({
        error: '申し訳ありません。選択された時間帯は満席となりました。別の時間帯をお選びください。',
      });
    }

    const totalPrice = content.price * peopleNum;

    const created = await db.createReservation({
      content_id: content.id,
      content_title: content.title,
      reservation_date,
      time_slot,
      customer_name: trimmedName,
      customer_email: trimmedEmail,
      customer_phone: trimmedPhone,
      people_count: peopleNum,
      total_price: totalPrice,
      status: '未対応',
      notes: trimmedNotes,
    });

    // メール通知（店舗宛 + お客様宛 仮予約メール）
    const [storeMailResult, customerMailResult] = await Promise.all([
      mailer.sendStoreNewReservationEmail(created, content),
      mailer.sendCustomerPendingEmail(created, content),
    ]);

    res.status(201).json({
      reservation: {
        ...created,
        content_title: content.title,
      },
      mail: {
        store: storeMailResult,
        customer: customerMailResult,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 外部リンク・SNS一覧
router.get('/links', async (req, res, next) => {
  try {
    const links = await db.listExternalLinks();
    res.json({ links });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
