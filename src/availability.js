/**
 * HH:MM 形式（00:00〜23:59）の時刻文字列チェック
 */
function isValidTimeString(timeStr) {
  if (typeof timeStr !== 'string') return false;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr.trim());
}

/**
 * 日本時間 (Asia/Tokyo) の今日の日付を YYYY-MM-DD 形式で返す
 */
function getTodayJST() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

/**
 * YYYY-MM-DD 形式の妥当性チェック
 */
function isValidDateString(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d
  );
}

/**
 * 時間帯配列を検証・正規化する（任意の HH:MM 形式を許可し、時刻昇順で返す）
 * 入力例: [{ time: "10:30", max_groups: 2 }]
 */
function normalizeTimeSlots(slots) {
  if (!Array.isArray(slots)) return [];
  const map = new Map();
  for (const item of slots) {
    if (!item || typeof item !== 'object') continue;
    const time = String(item.time || '').trim();
    if (!isValidTimeString(time)) continue;
    const maxGroups = Number(item.max_groups);
    if (!Number.isInteger(maxGroups) || maxGroups < 1) continue;
    map.set(time, { time, max_groups: maxGroups });
  }
  return Array.from(map.values()).sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * 指定日・指定商材の空き状況を計算する
 * - 日別上書き設定(dailySchedule)があればそれを優先（空配列なら受付停止）
 * - なければ商材の default_time_slots を適用
 * - キャンセル以外の予約を「1予約 = 1組」としてカウント（別商材とは干渉しない）
 */
function computeDayAvailability({
  content,
  targetDate,
  dailySchedule,
  reservationsForDay,
  todayJST = getTodayJST(),
}) {
  const isPast = targetDate < todayJST;
  const hasOverride = Boolean(dailySchedule);
  const rawSlots = hasOverride
    ? dailySchedule.custom_time_slots
    : content.default_time_slots;

  const configuredSlots = normalizeTimeSlots(rawSlots);

  const bookedCountByTime = new Map();
  for (const r of reservationsForDay || []) {
    if (r.status === 'キャンセル') continue;
    if (r.content_id !== content.id) continue;
    if (r.reservation_date !== targetDate) continue;
    const current = bookedCountByTime.get(r.time_slot) || 0;
    bookedCountByTime.set(r.time_slot, current + 1);
  }

  const slots = configuredSlots.map((slot) => {
    const bookedGroups = bookedCountByTime.get(slot.time) || 0;
    const remainingGroups = Math.max(0, slot.max_groups - bookedGroups);
    return {
      time: slot.time,
      max_groups: slot.max_groups,
      booked_groups: bookedGroups,
      remaining_groups: isPast ? 0 : remainingGroups,
      is_available: !isPast && remainingGroups > 0,
    };
  });

  const totalCapacity = slots.reduce((sum, s) => sum + s.max_groups, 0);
  const totalRemaining = slots.reduce((sum, s) => sum + s.remaining_groups, 0);
  const availableSlotCount = slots.filter((s) => s.is_available).length;

  let dayStatus = 'available';
  if (isPast) {
    dayStatus = 'past';
  } else if (slots.length === 0) {
    dayStatus = 'closed';
  } else if (totalRemaining === 0) {
    dayStatus = 'full';
  } else if (totalRemaining <= 2 || totalRemaining / Math.max(totalCapacity, 1) <= 0.35) {
    dayStatus = 'few';
  }

  return {
    date: targetDate,
    is_past: isPast,
    is_override: hasOverride,
    is_closed: !isPast && slots.length === 0,
    status: dayStatus,
    total_capacity: totalCapacity,
    total_remaining: totalRemaining,
    available_slot_count: availableSlotCount,
    slots,
  };
}

/**
 * 指定年月の全日付の空き状況を計算する
 */
function computeMonthAvailability({
  content,
  year,
  month,
  dailySchedules,
  reservations,
  todayJST = getTodayJST(),
}) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const scheduleMap = new Map();
  for (const ds of dailySchedules || []) {
    scheduleMap.set(ds.target_date, ds);
  }

  const reservationsByDate = new Map();
  for (const r of reservations || []) {
    if (r.status === 'キャンセル') continue;
    if (r.content_id !== content.id) continue;
    if (!reservationsByDate.has(r.reservation_date)) {
      reservationsByDate.set(r.reservation_date, []);
    }
    reservationsByDate.get(r.reservation_date).push(r);
  }

  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayInfo = computeDayAvailability({
      content,
      targetDate: dateStr,
      dailySchedule: scheduleMap.get(dateStr) || null,
      reservationsForDay: reservationsByDate.get(dateStr) || [],
      todayJST,
    });
    days.push(dayInfo);
  }

  return {
    year,
    month,
    today: todayJST,
    days,
  };
}

module.exports = {
  getTodayJST,
  isValidDateString,
  isValidTimeString,
  normalizeTimeSlots,
  computeDayAvailability,
  computeMonthAvailability,
};
