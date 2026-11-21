const nodemailer = require('nodemailer');
const config = require('./config');

let transporter = null;

function getTransporter() {
  if (!config.isMailConfigured) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: config.gmailUser,
        pass: config.gmailPass,
      },
    });
  }
  return transporter;
}

function formatYen(amount) {
  return `¥${Number(amount || 0).toLocaleString('ja-JP')}`;
}

function formatDateJa(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const wd = weekdays[date.getUTCDay()];
  return `${y}年${m}月${d}日（${wd}）`;
}

async function safeSendMail(mailOptions, label) {
  const client = getTransporter();
  if (!client) {
    console.log(
      `[MAIL SKIPPED] ${label} -> to: ${mailOptions.to} | subject: ${mailOptions.subject} (GMAIL_USER/GMAIL_PASS 未設定)`
    );
    return { sent: false, skipped: true };
  }

  try {
    const info = await client.sendMail({
      from: `"${config.storeName}" <${config.gmailUser}>`,
      ...mailOptions,
    });
    console.log(`[MAIL SENT] ${label} -> to: ${mailOptions.to} (id: ${info.messageId})`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[MAIL ERROR] ${label} -> to: ${mailOptions.to}:`, err.message);
    return { sent: false, error: err.message };
  }
}

async function sendStoreNewReservationEmail(reservation, content) {
  const title = content?.title || reservation.content_title || 'ワークショップ体験';
  const subject = `【新規予約】${title} / ${reservation.reservation_date} ${reservation.time_slot}（${reservation.customer_name}様）`;

  const text = [
    `${config.storeName} 管理担当者様`,
    '',
    '新しいワークショップ体験予約が入りました。',
    '管理画面より内容をご確認のうえ、「予約を受け入れる」処理を行ってください。',
    '',
    '========================================',
    `■ 体験メニュー：${title}`,
    `■ 予約日時　　：${formatDateJa(reservation.reservation_date)} ${reservation.time_slot}`,
    `■ 参加人数　　：${reservation.people_count}名`,
    `■ 合計金額　　：${formatYen(reservation.total_price)}`,
    '----------------------------------------',
    `■ お客様名　　：${reservation.customer_name} 様`,
    `■ 電話番号　　：${reservation.customer_phone}`,
    `■ メール　　　：${reservation.customer_email}`,
    `■ 備考　　　　：${reservation.notes || 'なし'}`,
    '========================================',
    '',
    `予約ID: ${reservation.id}`,
    `ステータス: ${reservation.status}`,
  ].join('\n');

  return safeSendMail(
    {
      to: config.storeNotifyEmail,
      replyTo: reservation.customer_email,
      subject,
      text,
    },
    '店舗宛・新規予約通知'
  );
}

async function sendCustomerPendingEmail(reservation, content) {
  const title = content?.title || reservation.content_title || 'ワークショップ体験';
  const subject = `【${config.storeName}】ご予約受付（仮予約）のお知らせ`;

  const text = [
    `${reservation.customer_name} 様`,
    '',
    `この度は ${config.storeName} へワークショップ体験をお申し込みいただき、誠にありがとうございます。`,
    '',
    '現在【仮予約】として承っております。',
    '店舗にて内容を確認のうえ、あらためて「予約確定メール」をお送りいたしますので、今しばらくお待ちください。',
    '',
    '========================================',
    `■ 体験メニュー：${title}`,
    `■ ご希望日時　：${formatDateJa(reservation.reservation_date)} ${reservation.time_slot}`,
    `■ ご参加人数　：${reservation.people_count}名`,
    `■ 合計金額　　：${formatYen(reservation.total_price)}（当日お支払い／税込）`,
    `■ 備考　　　　：${reservation.notes || 'なし'}`,
    '========================================',
    '',
    '※ ご不明な点やキャンセル・変更のご連絡は、下記メールアドレスまでお問い合わせください。',
    '',
    '----------------------------------------',
    `${config.storeName}`,
    `Email: ${config.storeNotifyEmail}`,
    '----------------------------------------',
  ].join('\n');

  return safeSendMail(
    {
      to: reservation.customer_email,
      replyTo: config.storeNotifyEmail,
      subject,
      text,
    },
    'お客様宛・仮予約受付メール'
  );
}

async function sendCustomerConfirmedEmail(reservation, content) {
  const title = content?.title || reservation.content_title || 'ワークショップ体験';
  const subject = `【${config.storeName}】ご予約が確定いたしました`;

  const text = [
    `${reservation.customer_name} 様`,
    '',
    `お申し込みいただいておりました ${config.storeName} のワークショップ体験につきまして、`,
    '以下の内容で【ご予約が確定】いたしました。',
    '',
    '========================================',
    `■ 体験メニュー：${title}`,
    `■ ご予約日時　：${formatDateJa(reservation.reservation_date)} ${reservation.time_slot}`,
    `■ ご参加人数　：${reservation.people_count}名`,
    `■ 合計金額　　：${formatYen(reservation.total_price)}`,
    `■ 備考　　　　：${reservation.notes || 'なし'}`,
    '========================================',
    '',
    '当日は開始時間の5〜10分前を目安にお越しいただけますとスムーズです。',
    'スタッフ一同、お会いできるのを心より楽しみにしております。',
    '',
    '※ やむを得ず日程変更やキャンセルをご希望の場合は、お早めに下記までご連絡ください。',
    '',
    '----------------------------------------',
    `${config.storeName}`,
    `Email: ${config.storeNotifyEmail}`,
    '----------------------------------------',
  ].join('\n');

  return safeSendMail(
    {
      to: reservation.customer_email,
      replyTo: config.storeNotifyEmail,
      subject,
      text,
    },
    'お客様宛・予約確定メール'
  );
}

module.exports = {
  sendStoreNewReservationEmail,
  sendCustomerPendingEmail,
  sendCustomerConfirmedEmail,
  formatDateJa,
  formatYen,
};
