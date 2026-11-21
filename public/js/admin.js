(() => {
  const DEFAULT_TIME_SLOTS = ['10:00', '11:30', '13:00', '14:30', '16:00', '17:30', '19:00'];

  const state = {
    authenticated: false,
    storeName: 'ARTYHUB 長野',
    timeSlots: DEFAULT_TIME_SLOTS,
    activeTab: 'reservations',
    resYear: new Date().getFullYear(),
    resMonth: new Date().getMonth() + 1,
    selectedResDate: null,
    filterStatus: '',
    filterContentId: '',
    reservations: [],
    contents: [],
    dailySchedules: [],
    links: [],
    activeReservation: null,
    manualDaySlots: [],
    confirmCallback: null,
  };

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatYen(amount) {
    return `¥${Number(amount || 0).toLocaleString('ja-JP')}`;
  }

  function formatDateJa(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const wds = ['日', '月', '火', '水', '木', '金', '土'];
    return `${y}年${m}月${d}日（${wds[dt.getUTCDay()]}）`;
  }

  function formatDateTimeJa(isoStr) {
    if (!isoStr) return '-';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return isoStr;
    return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  }

  function getTodayLocalISO() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function showToast(message, type = 'default') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 4200);
  }

  async function apiFetch(url, options = {}) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && url !== '/api/admin/login') {
      showLoginView();
      throw new Error('セッションが切れました。再度ログインしてください。');
    }
    if (!res.ok) {
      throw new Error(data.error || 'リクエストに失敗しました。');
    }
    return data;
  }

  // --------------------------------------------------------------------------
  // 2段階確認ダイアログ（「はい」「いいえ」の2択ボタン）
  // --------------------------------------------------------------------------
  function openConfirmDialog({ title, message, summaryHtml = '', yesClass = 'btn-success', onConfirm }) {
    document.getElementById('confirm-modal-title').textContent = title || '確認';
    document.getElementById('confirm-modal-message').textContent = message;

    const summaryEl = document.getElementById('confirm-modal-summary');
    if (summaryHtml) {
      summaryEl.innerHTML = summaryHtml;
      summaryEl.classList.remove('hidden');
    } else {
      summaryEl.innerHTML = '';
      summaryEl.classList.add('hidden');
    }

    const yesBtn = document.getElementById('confirm-yes-btn');
    yesBtn.className = `btn ${yesClass}`;
    yesBtn.disabled = false;
    yesBtn.textContent = 'はい';

    state.confirmCallback = onConfirm;
    document.getElementById('confirm-modal').classList.remove('hidden');
  }

  function closeConfirmDialog() {
    state.confirmCallback = null;
    document.getElementById('confirm-modal').classList.add('hidden');
  }

  // --------------------------------------------------------------------------
  // 認証・ビュー切替
  // --------------------------------------------------------------------------
  function showLoginView() {
    state.authenticated = false;
    document.getElementById('dashboard-view').classList.add('hidden');
    document.getElementById('login-view').classList.remove('hidden');
  }

  async function showDashboardView(sessionInfo) {
    state.authenticated = true;
    state.storeName = sessionInfo.storeName || 'ARTYHUB 長野';
    state.timeSlots = sessionInfo.timeSlots || DEFAULT_TIME_SLOTS;

    document.title = `${state.storeName} | 管理画面`;
    document.getElementById('login-store-title').textContent = `${state.storeName} 管理画面`;
    document.getElementById('admin-store-title').textContent = `${state.storeName} 管理画面`;

    const envPills = document.getElementById('env-pills');
    envPills.innerHTML = `
      <span class="env-pill ${sessionInfo.isSupabaseMode ? 'ok' : 'warn'}">
        DB: ${sessionInfo.isSupabaseMode ? 'Supabase 接続中' : 'ローカルデモモード'}
      </span>
      <span class="env-pill ${sessionInfo.isMailConfigured ? 'ok' : 'warn'}">
        メール: ${sessionInfo.isMailConfigured ? 'Gmail SMTP 有効' : '未設定（送信スキップ）'}
      </span>
    `;

    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('dashboard-view').classList.remove('hidden');

    await loadAllInitialData();
  }

  async function loadAllInitialData() {
    await Promise.all([loadContents(), loadLinks()]);
    populateContentFilters();
    await loadReservations();
    initDailyScheduleTab();
  }

  function switchTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('hidden', panel.id !== `tab-${tabName}`);
    });

    if (tabName === 'reservations') loadReservations();
    if (tabName === 'contents') loadContents();
    if (tabName === 'daily') loadDailySchedulesAndDetail();
    if (tabName === 'links') loadLinks();
  }

  // --------------------------------------------------------------------------
  // タブ1：予約カレンダー＆一覧管理
  // --------------------------------------------------------------------------
  function populateContentFilters() {
    const resFilter = document.getElementById('res-filter-content');
    const prevRes = resFilter.value;
    resFilter.innerHTML =
      '<option value="">すべての商材</option>' +
      state.contents
        .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)}</option>`)
        .join('');
    resFilter.value = prevRes;

    const dailySelect = document.getElementById('daily-content-select');
    const prevDaily = dailySelect.value;
    if (state.contents.length) {
      dailySelect.innerHTML = state.contents
        .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)}</option>`)
        .join('');
      if (prevDaily && state.contents.some((c) => c.id === prevDaily)) {
        dailySelect.value = prevDaily;
      }
    } else {
      dailySelect.innerHTML = '<option value="">商材がありません</option>';
    }
  }

  async function loadReservations() {
    document.getElementById('res-month-label').textContent = `${state.resYear}年${state.resMonth}月`;
    const params = new URLSearchParams({
      year: String(state.resYear),
      month: String(state.resMonth),
    });
    if (state.filterStatus) params.set('status', state.filterStatus);
    if (state.filterContentId) params.set('contentId', state.filterContentId);

    try {
      const data = await apiFetch(`/api/admin/reservations?${params.toString()}`);
      state.reservations = data.reservations || [];
      renderReservationStats();
      renderAdminCalendar();
      renderReservationsTable();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderReservationStats() {
    const total = state.reservations.length;
    const pending = state.reservations.filter((r) => r.status === '未対応').length;
    const confirmed = state.reservations.filter((r) => r.status === '確定').length;
    const visited = state.reservations.filter((r) => r.status === '来店済').length;

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-pending').textContent = pending;
    document.getElementById('stat-confirmed').textContent = confirmed;
    document.getElementById('stat-visited').textContent = visited;

    const badge = document.getElementById('pending-count-badge');
    if (pending > 0) {
      badge.textContent = pending;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  function renderAdminCalendar() {
    const grid = document.getElementById('admin-calendar-grid');
    const firstWeekday = new Date(Date.UTC(state.resYear, state.resMonth - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(state.resYear, state.resMonth, 0)).getUTCDate();

    const byDate = new Map();
    for (const r of state.reservations) {
      if (!byDate.has(r.reservation_date)) byDate.set(r.reservation_date, []);
      byDate.get(r.reservation_date).push(r);
    }

    let html = '';
    for (let i = 0; i < firstWeekday; i++) {
      html += '<div class="admin-cal-cell is-empty"></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${state.resYear}-${String(state.resMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const list = byDate.get(dateStr) || [];
      const activeList = list.filter((r) => r.status !== 'キャンセル');
      const pendingCount = list.filter((r) => r.status === '未対応').length;
      const isSelected = state.selectedResDate === dateStr;

      const previewHtml = list
        .slice(0, 2)
        .map(
          (r) =>
            `<div class="cal-mini-item status-${escapeHtml(r.status)}">
              ${escapeHtml(r.time_slot)} ${escapeHtml(r.customer_name)}
            </div>`
        )
        .join('');
      const moreHtml =
        list.length > 2
          ? `<div style="font-size:11px;color:var(--text-muted);">+他${list.length - 2}件</div>`
          : '';

      html += `
        <button
          type="button"
          class="admin-cal-cell ${isSelected ? 'is-selected' : ''}"
          data-res-date="${dateStr}"
        >
          <div class="admin-cal-cell-head">
            <span class="admin-cal-day">${d}</span>
            ${
              list.length > 0
                ? `<span class="admin-cal-count ${pendingCount > 0 ? 'has-pending' : ''}">
                    ${pendingCount > 0 ? `未${pendingCount}/` : ''}${activeList.length}件
                  </span>`
                : ''
            }
          </div>
          ${previewHtml}
          ${moreHtml}
        </button>
      `;
    }

    grid.innerHTML = html;
    grid.querySelectorAll('.admin-cal-cell[data-res-date]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const clicked = btn.dataset.resDate;
        state.selectedResDate = state.selectedResDate === clicked ? null : clicked;
        renderAdminCalendar();
        renderReservationsTable();
      });
    });
  }

  function renderReservationsTable() {
    const tbody = document.getElementById('reservations-tbody');
    const mobileList = document.getElementById('reservations-mobile-list');
    const titleEl = document.getElementById('res-list-title');
    const clearBtn = document.getElementById('res-clear-date-btn');
    const addSelectedBtn = document.getElementById('res-add-selected-date-btn');

    let list = state.reservations;
    if (state.selectedResDate) {
      list = list.filter((r) => r.reservation_date === state.selectedResDate);
      titleEl.textContent = `${formatDateJa(state.selectedResDate)} の予約一覧（${list.length}件）`;
      clearBtn.classList.remove('hidden');
      addSelectedBtn.textContent = `＋ ${state.selectedResDate} に電話予約を追加`;
    } else {
      titleEl.textContent = `${state.resYear}年${state.resMonth}月の予約一覧（${list.length}件）`;
      clearBtn.classList.add('hidden');
      addSelectedBtn.textContent = '＋ 電話・手動予約を追加';
    }

    if (!list.length) {
      tbody.innerHTML =
        '<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--text-muted);">該当する予約はありません。</td></tr>';
      mobileList.innerHTML = '<div class="empty-box">該当する予約はありません。</div>';
      return;
    }

    tbody.innerHTML = list
      .map(
        (r) => `
          <tr class="clickable-row" data-reservation-id="${escapeHtml(r.id)}">
            <td style="white-space:nowrap;">${escapeHtml(r.reservation_date)}</td>
            <td style="font-weight:700;">${escapeHtml(r.time_slot)}</td>
            <td>${escapeHtml(r.content_title)}</td>
            <td style="font-weight:600;">${escapeHtml(r.customer_name)} 様</td>
            <td>${r.people_count}名</td>
            <td>${formatYen(r.total_price)}</td>
            <td><span class="status-badge status-${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
            <td>
              <button type="button" class="btn btn-secondary btn-sm open-detail-btn" data-reservation-id="${escapeHtml(r.id)}">
                詳細・対応
              </button>
            </td>
          </tr>
        `
      )
      .join('');

    mobileList.innerHTML = list
      .map(
        (r) => `
          <button
            type="button"
            class="res-mobile-card status-border-${escapeHtml(r.status)}"
            data-reservation-id="${escapeHtml(r.id)}"
          >
            <div class="res-mobile-head">
              <span class="res-mobile-datetime">${escapeHtml(r.reservation_date)} <strong>${escapeHtml(r.time_slot)}</strong></span>
              <span class="status-badge status-${escapeHtml(r.status)}">${escapeHtml(r.status)}</span>
            </div>
            <div class="res-mobile-customer">
              <span>${escapeHtml(r.customer_name)} 様</span>
              <span class="res-mobile-meta">${r.people_count}名 / ${formatYen(r.total_price)}</span>
            </div>
            <div class="res-mobile-foot">
              <span class="res-mobile-content">${escapeHtml(r.content_title)}</span>
              <span class="res-mobile-tap">詳細・対応 ›</span>
            </div>
          </button>
        `
      )
      .join('');

    tbody.querySelectorAll('tr.clickable-row').forEach((row) => {
      row.addEventListener('click', () => {
        const resObj = state.reservations.find((r) => r.id === row.dataset.reservationId);
        if (resObj) openReservationModal(resObj);
      });
    });

    mobileList.querySelectorAll('.res-mobile-card').forEach((card) => {
      card.addEventListener('click', () => {
        const resObj = state.reservations.find((r) => r.id === card.dataset.reservationId);
        if (resObj) openReservationModal(resObj);
      });
    });
  }

  function openReservationModal(reservation) {
    state.activeReservation = reservation;
    const body = document.getElementById('reservation-detail-body');
    const emailHtml = reservation.customer_email
      ? `<a href="mailto:${escapeHtml(reservation.customer_email)}">${escapeHtml(reservation.customer_email)}</a>`
      : '<span style="color:var(--text-muted);">未登録（電話予約等）</span>';

    body.innerHTML = `
      <div class="detail-item"><dt>ステータス</dt><dd><span class="status-badge status-${escapeHtml(reservation.status)}">${escapeHtml(reservation.status)}</span></dd></div>
      <div class="detail-item"><dt>体験メニュー</dt><dd><strong>${escapeHtml(reservation.content_title)}</strong></dd></div>
      <div class="detail-item"><dt>予約日時</dt><dd><strong>${formatDateJa(reservation.reservation_date)} ${escapeHtml(reservation.time_slot)}</strong></dd></div>
      <div class="detail-item"><dt>参加人数</dt><dd>${reservation.people_count}名</dd></div>
      <div class="detail-item"><dt>合計金額</dt><dd>${formatYen(reservation.total_price)}</dd></div>
      <div class="detail-item"><dt>お客様名</dt><dd>${escapeHtml(reservation.customer_name)} 様</dd></div>
      <div class="detail-item"><dt>電話番号</dt><dd><a href="tel:${escapeHtml(reservation.customer_phone)}">${escapeHtml(reservation.customer_phone)}</a></dd></div>
      <div class="detail-item"><dt>メール</dt><dd>${emailHtml}</dd></div>
      <div class="detail-item"><dt>備考</dt><dd>${escapeHtml(reservation.notes || 'なし')}</dd></div>
      <div class="detail-item"><dt>申込日時</dt><dd>${escapeHtml(formatDateTimeJa(reservation.created_at))}</dd></div>
    `;

    const acceptBtn = document.getElementById('btn-accept-reservation');
    const visitedBtn = document.getElementById('btn-visited-reservation');
    const cancelBtn = document.getElementById('btn-cancel-reservation');

    acceptBtn.disabled = reservation.status === '確定' || reservation.status === '来店済';
    visitedBtn.disabled = reservation.status === '来店済' || reservation.status === 'キャンセル';
    cancelBtn.disabled = reservation.status === 'キャンセル';

    document.getElementById('reservation-modal').classList.remove('hidden');
  }

  // --------------------------------------------------------------------------
  // 電話・手動予約の追加＆既存予約の編集モーダル（満席時の強制追加対応）
  // --------------------------------------------------------------------------
  function populateManualContentSelect(selectedId = '') {
    const select = document.getElementById('res-edit-content');
    if (!state.contents.length) {
      select.innerHTML = '<option value="">商材が登録されていません</option>';
      return;
    }
    select.innerHTML = state.contents
      .map(
        (c) =>
          `<option value="${escapeHtml(c.id)}" ${c.id === selectedId ? 'selected' : ''}>
            ${escapeHtml(c.title)}（${formatYen(c.price)} / 1名${c.is_active ? '' : '・非公開'}）
          </option>`
      )
      .join('');
    if (selectedId && state.contents.some((c) => c.id === selectedId)) {
      select.value = selectedId;
    }
  }

  function updateManualPricePreview() {
    const contentId = document.getElementById('res-edit-content').value;
    const people = Math.max(1, Number(document.getElementById('res-edit-people').value) || 1);
    const content = state.contents.find((c) => c.id === contentId);
    const total = content ? content.price * people : 0;

    document.getElementById('res-edit-total-price').textContent = formatYen(total);
    document.getElementById('res-edit-max-people-hint').textContent = content
      ? `（通常上限 ${content.max_people_per_group}名・超過入力可）`
      : '';
  }

  function updateManualOverbookNotice() {
    const notice = document.getElementById('manual-overbook-notice');
    const selectedTime = document.getElementById('res-edit-time').value;
    if (!selectedTime) {
      notice.classList.add('hidden');
      notice.textContent = '';
      return;
    }

    const matched = state.manualDaySlots.find((s) => s.time === selectedTime);
    if (!matched) {
      notice.textContent = `※ ${selectedTime} はこの日の通常受付枠外（または受付停止日）ですが、管理者権限で強制登録できます。`;
      notice.classList.remove('hidden');
    } else if (matched.remaining_groups <= 0) {
      notice.textContent = `※ ${selectedTime} は現在満席（${matched.booked_groups}/${matched.max_groups}組）ですが、管理者権限で強制追加できます。`;
      notice.classList.remove('hidden');
    } else {
      notice.classList.add('hidden');
      notice.textContent = '';
    }
  }

  function renderManualSlotChips() {
    const wrap = document.getElementById('manual-slots-chips');
    const currentTime = document.getElementById('res-edit-time').value;

    if (!state.manualDaySlots.length) {
      wrap.innerHTML =
        '<div style="font-size:12px;color:var(--text-muted);">この日は受付停止または枠未設定です。下の「開始時刻」欄へ直接時刻を入力して強制追加できます。</div>';
      updateManualOverbookNotice();
      return;
    }

    wrap.innerHTML = state.manualDaySlots
      .map((s) => {
        const isFull = s.remaining_groups <= 0;
        const isSelected = currentTime === s.time;
        const subText = isFull
          ? `満席(${s.booked_groups}/${s.max_groups}) 強制可`
          : `残り${s.remaining_groups}組 (${s.booked_groups}/${s.max_groups})`;
        return `
          <button
            type="button"
            class="manual-slot-chip ${isFull ? 'is-full' : ''} ${isSelected ? 'is-selected' : ''}"
            data-slot-time="${escapeHtml(s.time)}"
          >
            <span class="chip-time">${escapeHtml(s.time)}</span>
            <span class="chip-sub">${escapeHtml(subText)}</span>
          </button>
        `;
      })
      .join('');

    wrap.querySelectorAll('.manual-slot-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('res-edit-time').value = btn.dataset.slotTime;
        renderManualSlotChips();
      });
    });

    updateManualOverbookNotice();
  }

  async function loadManualDaySlots() {
    const contentId = document.getElementById('res-edit-content').value;
    const date = document.getElementById('res-edit-date').value;
    const excludeId = document.getElementById('res-edit-id').value;
    const wrap = document.getElementById('manual-slots-chips');

    if (!contentId || !date) {
      state.manualDaySlots = [];
      wrap.innerHTML = '';
      updateManualOverbookNotice();
      return;
    }

    wrap.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">空き枠を確認中...</span>';
    try {
      const params = new URLSearchParams({ contentId, date });
      if (excludeId) params.set('excludeReservationId', excludeId);
      const data = await apiFetch(`/api/admin/availability/day?${params.toString()}`);
      state.manualDaySlots = data.slots || [];

      // 新規追加時で時刻が空なら最初の枠を自動選択
      const timeInput = document.getElementById('res-edit-time');
      if (!timeInput.value && state.manualDaySlots.length > 0) {
        const firstOpen = state.manualDaySlots.find((s) => s.remaining_groups > 0);
        timeInput.value = (firstOpen || state.manualDaySlots[0]).time;
      }
      renderManualSlotChips();
    } catch (err) {
      state.manualDaySlots = [];
      wrap.innerHTML = `<span style="font-size:12px;color:var(--danger);">${escapeHtml(err.message)}</span>`;
      updateManualOverbookNotice();
    }
  }

  async function openReservationEditModal(reservation = null, presetDate = null) {
    if (!state.contents.length) {
      showToast('先に「商材（コンテンツ）管理」から体験メニューを登録してください。', 'error');
      return;
    }

    document.getElementById('res-edit-error').classList.add('hidden');
    const sendMailWrap = document.getElementById('res-edit-send-mail-wrap');
    document.getElementById('res-edit-send-mail').checked = false;

    if (reservation) {
      document.getElementById('res-edit-modal-title').textContent = '予約内容を編集';
      document.getElementById('res-edit-save-btn').textContent = '変更を保存する';
      document.getElementById('res-edit-id').value = reservation.id;
      populateManualContentSelect(reservation.content_id || state.contents[0].id);
      document.getElementById('res-edit-date').value = reservation.reservation_date;
      document.getElementById('res-edit-time').value = reservation.time_slot;
      document.getElementById('res-edit-status').value = reservation.status;
      document.getElementById('res-edit-people').value = reservation.people_count;
      document.getElementById('res-edit-name').value = reservation.customer_name;
      document.getElementById('res-edit-phone').value = reservation.customer_phone;
      document.getElementById('res-edit-email').value = reservation.customer_email || '';
      document.getElementById('res-edit-notes').value = reservation.notes || '';
      sendMailWrap.classList.add('hidden');
    } else {
      document.getElementById('res-edit-modal-title').textContent = '電話・手動予約を追加';
      document.getElementById('res-edit-save-btn').textContent = '予約を登録する';
      document.getElementById('res-edit-id').value = '';
      document.getElementById('reservation-edit-form').reset();
      populateManualContentSelect(state.filterContentId || state.contents[0].id);
      document.getElementById('res-edit-date').value =
        presetDate || state.selectedResDate || getTodayLocalISO();
      document.getElementById('res-edit-time').value = '';
      document.getElementById('res-edit-status').value = '確定';
      document.getElementById('res-edit-people').value = 2;
      document.getElementById('res-edit-notes').value = '電話予約';
      sendMailWrap.classList.remove('hidden');
    }

    updateManualPricePreview();
    document.getElementById('reservation-edit-modal').classList.remove('hidden');
    await loadManualDaySlots();
  }

  async function updateReservationStatus(reservation, newStatus, sendConfirmationEmail = false) {
    try {
      const res = await apiFetch(`/api/admin/reservations/${encodeURIComponent(reservation.id)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, sendConfirmationEmail }),
      });

      let msg = `ステータスを「${newStatus}」に更新しました。`;
      if (newStatus === '確定' && res.mail) {
        if (res.mail.sent) {
          msg += ' お客様へ確定メールを送信しました。';
        } else if (res.mail.skipped) {
          msg += '（※メール未設定のため送信はスキップされました）';
        } else {
          msg += '（※確定メール送信でエラーが発生しました）';
        }
      }

      showToast(msg, 'success');
      document.getElementById('reservation-modal').classList.add('hidden');
      await loadReservations();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // --------------------------------------------------------------------------
  // タブ2：商材（コンテンツ）管理 & 共通時間帯エディタ
  // --------------------------------------------------------------------------
  const TIME_HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

  function createSlotRowElement({ time = '10:00', maxGroups = 2, enabled = true, booked = 0, disabled = false }) {
    const row = document.createElement('div');
    const isEnabled = !disabled && enabled;
    row.className = `slot-config-item ${isEnabled ? 'is-enabled' : ''}`;

    row.innerHTML = `
      <div class="slot-left-wrap">
        <div class="slot-check-label">
          <input
            type="checkbox"
            class="slot-checkbox"
            ${isEnabled ? 'checked' : ''}
            ${disabled ? 'disabled' : ''}
            aria-label="この時間帯を有効にする"
          />
          <input
            type="time"
            class="slot-time-input"
            value="${escapeHtml(time)}"
            ${disabled ? 'disabled' : ''}
            aria-label="開始時刻"
          />
        </div>
        ${booked > 0 ? `<div style="font-size:11px;color:var(--warning);margin-left:22px;">予約済: ${booked}組</div>` : ''}
      </div>
      <div class="slot-groups-wrap">
        <input
          type="number"
          class="slot-groups-input"
          min="1"
          max="30"
          value="${Number(maxGroups) || 2}"
          ${isEnabled ? '' : 'disabled'}
          aria-label="最大組数"
        />
        <span>組</span>
        <button
          type="button"
          class="slot-remove-btn"
          title="この時間帯を削除"
          aria-label="この時間帯を削除"
          ${disabled ? 'disabled' : ''}
        >×</button>
      </div>
    `;

    const cb = row.querySelector('.slot-checkbox');
    const num = row.querySelector('.slot-groups-input');
    const removeBtn = row.querySelector('.slot-remove-btn');

    cb.addEventListener('change', () => {
      num.disabled = !cb.checked;
      row.classList.toggle('is-enabled', cb.checked);
    });

    removeBtn.addEventListener('click', () => {
      row.remove();
    });

    return row;
  }

  function renderSlotConfigurator(
    containerId,
    activeSlots = [],
    bookedByTime = null,
    disabled = false,
    { usePresetWhenEmpty = false } = {}
  ) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    const normalized = Array.isArray(activeSlots) ? activeSlots : [];
    const rowsData = [];

    if (normalized.length > 0) {
      const seen = new Set();
      for (const s of normalized) {
        seen.add(s.time);
        rowsData.push({
          time: s.time,
          maxGroups: s.max_groups || 2,
          enabled: true,
          booked: bookedByTime ? bookedByTime[s.time] || 0 : 0,
        });
      }
      if (bookedByTime) {
        Object.keys(bookedByTime)
          .sort()
          .forEach((time) => {
            if (!seen.has(time) && bookedByTime[time] > 0) {
              rowsData.push({
                time,
                maxGroups: 2,
                enabled: false,
                booked: bookedByTime[time],
              });
            }
          });
      }
      rowsData.sort((a, b) => a.time.localeCompare(b.time));
    } else if (usePresetWhenEmpty || disabled) {
      for (const time of state.timeSlots) {
        rowsData.push({
          time,
          maxGroups: 2,
          enabled: false,
          booked: bookedByTime ? bookedByTime[time] || 0 : 0,
        });
      }
    }

    if (rowsData.length === 0) {
      const emptyNote = document.createElement('div');
      emptyNote.className = 'empty-box';
      emptyNote.style.gridColumn = '1 / -1';
      emptyNote.style.padding = '14px';
      emptyNote.textContent = '時間帯がありません。「＋ 時間帯を追加」または「基本7枠」から設定してください。';
      container.appendChild(emptyNote);
      return;
    }

    for (const item of rowsData) {
      container.appendChild(createSlotRowElement({ ...item, disabled }));
    }
  }

  function suggestNextSlotTime(containerId) {
    const container = document.getElementById(containerId);
    const times = Array.from(container.querySelectorAll('.slot-time-input'))
      .map((el) => el.value)
      .filter((v) => TIME_HHMM_REGEX.test(v))
      .sort();

    if (!times.length) return '10:00';
    const last = times[times.length - 1];
    const [h, m] = last.split(':').map(Number);
    const nextTotal = h * 60 + m + 90;
    if (nextTotal > 22 * 60 + 30) return '10:30';
    const nh = String(Math.floor(nextTotal / 60)).padStart(2, '0');
    const nm = String(nextTotal % 60).padStart(2, '0');
    return `${nh}:${nm}`;
  }

  function appendNewSlotRow(containerId) {
    const container = document.getElementById(containerId);
    const emptyBox = container.querySelector('.empty-box');
    if (emptyBox) emptyBox.remove();

    const suggested = suggestNextSlotTime(containerId);
    const row = createSlotRowElement({
      time: suggested,
      maxGroups: 2,
      enabled: true,
      booked: 0,
      disabled: false,
    });
    container.appendChild(row);
    const timeInput = row.querySelector('.slot-time-input');
    if (timeInput) timeInput.focus();
  }

  function readSlotConfigurator(containerId) {
    const container = document.getElementById(containerId);
    const slots = [];
    const seen = new Set();

    const rows = container.querySelectorAll('.slot-config-item');
    for (const row of rows) {
      const cb = row.querySelector('.slot-checkbox');
      const timeInput = row.querySelector('.slot-time-input');
      const num = row.querySelector('.slot-groups-input');
      if (!cb.checked || cb.disabled) continue;

      const time = String(timeInput.value || '').trim();
      if (!TIME_HHMM_REGEX.test(time)) {
        return { error: '有効な時間帯（HH:MM形式）を入力してください。' };
      }
      if (seen.has(time)) {
        return { error: `同じ時間帯（${time}）が重複しています。別の時刻に変更するか不要な行を削除してください。` };
      }
      seen.add(time);

      const maxGroups = Number(num.value);
      if (!Number.isInteger(maxGroups) || maxGroups < 1) {
        return { error: `時間帯 ${time} の最大組数は1以上の整数で入力してください。` };
      }
      slots.push({ time, max_groups: maxGroups });
    }

    slots.sort((a, b) => a.time.localeCompare(b.time));
    return { slots };
  }

  async function loadContents() {
    try {
      const data = await apiFetch('/api/admin/contents');
      state.contents = data.contents || [];
      renderContentsAdmin();
      populateContentFilters();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderContentsAdmin() {
    const grid = document.getElementById('admin-contents-grid');
    if (!state.contents.length) {
      grid.innerHTML = '<div class="empty-box">登録されている商材がありません。「＋ 新規商材を追加」から作成してください。</div>';
      return;
    }

    grid.innerHTML = state.contents
      .map((c) => {
        const thumbHtml = c.image_url
          ? `<img src="${escapeHtml(c.image_url)}" alt="${escapeHtml(c.title)}" />`
          : '<span>写真未設定</span>';
        const slotsHtml = (c.default_time_slots || []).length
          ? c.default_time_slots
              .map((s) => `<span class="slot-tag">${escapeHtml(s.time)} (${s.max_groups}組)</span>`)
              .join('')
          : '<span class="slot-tag">開催枠未設定</span>';

        return `
          <div class="admin-content-card">
            <div class="admin-content-thumb">${thumbHtml}</div>
            <div class="admin-content-body">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <strong style="font-size:16px;">${escapeHtml(c.title)}</strong>
                <span class="status-badge ${c.is_active ? 'status-確定' : 'status-キャンセル'}">
                  ${c.is_active ? '公開中' : '非公開'}
                </span>
              </div>
              <div style="font-size:13px;color:var(--text-muted);">
                料金: <strong>${formatYen(c.price)}</strong> / 1名 ｜ 上限: <strong>1組 ${c.max_people_per_group}名</strong> ｜ 表示順: ${c.sort_order}
              </div>
              <p style="margin:0;font-size:13px;color:var(--text-muted);">${escapeHtml(c.description || '説明なし')}</p>
              <div class="slot-tags">${slotsHtml}</div>
              <div class="card-actions">
                <button type="button" class="btn btn-secondary btn-sm edit-content-btn" data-id="${escapeHtml(c.id)}">編集</button>
                <button type="button" class="btn btn-danger-outline btn-sm delete-content-btn" data-id="${escapeHtml(c.id)}">削除</button>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    grid.querySelectorAll('.edit-content-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = state.contents.find((c) => c.id === btn.dataset.id);
        if (target) openContentModal(target);
      });
    });

    grid.querySelectorAll('.delete-content-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = state.contents.find((c) => c.id === btn.dataset.id);
        if (!target) return;
        openConfirmDialog({
          title: '商材の削除確認',
          message: `商材「${target.title}」を削除しますか？`,
          yesClass: 'btn-danger',
          onConfirm: async () => {
            await apiFetch(`/api/admin/contents/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
            showToast('商材を削除しました。', 'success');
            await loadContents();
          },
        });
      });
    });
  }

  function updateDescCounter() {
    const len = document.getElementById('content-description').value.length;
    document.getElementById('desc-char-count').textContent = `${len}文字 / 100文字目安`;
  }

  function updateImagePreview(url) {
    const img = document.getElementById('content-image-preview');
    if (url) {
      img.src = url;
      img.classList.remove('hidden');
    } else {
      img.src = '';
      img.classList.add('hidden');
    }
  }

  function openContentModal(content = null) {
    document.getElementById('content-form-error').classList.add('hidden');
    document.getElementById('content-image-file').value = '';
    document.getElementById('upload-status-text').textContent = 'JPG/PNG/WebP/GIF（5MBまで）';

    if (content) {
      document.getElementById('content-modal-title').textContent = '商材を編集';
      document.getElementById('content-id').value = content.id;
      document.getElementById('content-title').value = content.title;
      document.getElementById('content-price').value = content.price;
      document.getElementById('content-max-people').value = content.max_people_per_group;
      document.getElementById('content-image-url').value = content.image_url || '';
      document.getElementById('content-description').value = content.description || '';
      document.getElementById('content-sort-order').value = content.sort_order ?? 0;
      document.getElementById('content-is-active').checked = content.is_active !== false;
      updateImagePreview(content.image_url || '');
      renderSlotConfigurator('content-slots-config', content.default_time_slots || [], null, false, {
        usePresetWhenEmpty: true,
      });
    } else {
      document.getElementById('content-modal-title').textContent = '新規商材を追加';
      document.getElementById('content-id').value = '';
      document.getElementById('content-form').reset();
      document.getElementById('content-max-people').value = 4;
      document.getElementById('content-sort-order').value = state.contents.length + 1;
      document.getElementById('content-is-active').checked = true;
      updateImagePreview('');
      renderSlotConfigurator('content-slots-config', [
        { time: '10:00', max_groups: 2 },
        { time: '13:00', max_groups: 2 },
        { time: '16:00', max_groups: 2 },
      ]);
    }
    updateDescCounter();
    document.getElementById('content-modal').classList.remove('hidden');
  }

  // --------------------------------------------------------------------------
  // タブ3：日別の予約枠変更
  // --------------------------------------------------------------------------
  function initDailyScheduleTab() {
    const dateInput = document.getElementById('daily-date-input');
    if (!dateInput.value) {
      dateInput.value = getTodayLocalISO();
    }
    loadDailySchedulesAndDetail();
  }

  async function loadDailySchedulesAndDetail() {
    await Promise.all([loadDailySchedulesList(), loadDailyScheduleDetail()]);
  }

  async function loadDailySchedulesList() {
    const listEl = document.getElementById('daily-schedules-list');
    try {
      const data = await apiFetch('/api/admin/daily-schedules');
      state.dailySchedules = data.schedules || [];
      if (!state.dailySchedules.length) {
        listEl.innerHTML = '<div class="empty-box">日別の上書き設定はまだありません。</div>';
        return;
      }

      listEl.innerHTML = state.dailySchedules
        .map((s) => {
          const isClosed = !s.custom_time_slots || s.custom_time_slots.length === 0;
          const summary = isClosed
            ? '<span class="status-badge status-キャンセル">受付停止</span>'
            : s.custom_time_slots
                .map((sl) => `<span class="slot-tag">${escapeHtml(sl.time)}(${sl.max_groups}組)</span>`)
                .join(' ');

          return `
            <div style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">
                <div>
                  <strong>${escapeHtml(s.target_date)}</strong>
                  <span style="font-size:13px;color:var(--text-muted);margin-left:6px;">${escapeHtml(s.content_title)}</span>
                </div>
                <div style="display:flex;gap:6px;">
                  <button type="button" class="btn btn-secondary btn-sm load-daily-btn" data-content-id="${escapeHtml(s.content_id)}" data-date="${escapeHtml(s.target_date)}">編集</button>
                  <button type="button" class="btn btn-danger-outline btn-sm del-daily-btn" data-content-id="${escapeHtml(s.content_id)}" data-date="${escapeHtml(s.target_date)}">解除</button>
                </div>
              </div>
              <div class="slot-tags">${summary}</div>
            </div>
          `;
        })
        .join('');

      listEl.querySelectorAll('.load-daily-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          document.getElementById('daily-content-select').value = btn.dataset.contentId;
          document.getElementById('daily-date-input').value = btn.dataset.date;
          loadDailyScheduleDetail();
        });
      });

      listEl.querySelectorAll('.del-daily-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await apiFetch(
              `/api/admin/daily-schedules?contentId=${encodeURIComponent(btn.dataset.contentId)}&date=${encodeURIComponent(btn.dataset.date)}`,
              { method: 'DELETE' }
            );
            showToast('日別の上書き設定を解除しました。', 'success');
            await loadDailySchedulesAndDetail();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    } catch (err) {
      listEl.innerHTML = `<div class="alert-error">${escapeHtml(err.message)}</div>`;
    }
  }

  function setDailySlotButtonsDisabled(disabled) {
    document.getElementById('daily-add-slot-btn').disabled = disabled;
    document.getElementById('daily-preset-slots-btn').disabled = disabled;
  }

  async function loadDailyScheduleDetail() {
    const contentId = document.getElementById('daily-content-select').value;
    const date = document.getElementById('daily-date-input').value;
    const badge = document.getElementById('daily-mode-badge');
    const closedCb = document.getElementById('daily-closed-checkbox');

    if (!contentId || !date) {
      badge.classList.add('hidden');
      setDailySlotButtonsDisabled(true);
      renderSlotConfigurator('daily-slots-config', [], null, true);
      return;
    }

    try {
      const detail = await apiFetch(
        `/api/admin/daily-schedules/detail?contentId=${encodeURIComponent(contentId)}&date=${encodeURIComponent(date)}`
      );

      badge.classList.remove('hidden');
      if (detail.has_override) {
        const isClosed = detail.custom_time_slots.length === 0;
        badge.className = `status-badge ${isClosed ? 'status-キャンセル' : 'status-未対応'}`;
        badge.textContent = isClosed ? '日別設定：受付停止中' : '日別カスタム設定あり';
        closedCb.checked = isClosed;
        setDailySlotButtonsDisabled(isClosed);
        renderSlotConfigurator(
          'daily-slots-config',
          isClosed ? [] : detail.custom_time_slots,
          detail.booked_by_time,
          isClosed
        );
      } else {
        badge.className = 'status-badge status-確定';
        badge.textContent = '通常設定を適用中';
        closedCb.checked = false;
        setDailySlotButtonsDisabled(false);
        renderSlotConfigurator(
          'daily-slots-config',
          detail.default_time_slots,
          detail.booked_by_time,
          false,
          { usePresetWhenEmpty: true }
        );
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // --------------------------------------------------------------------------
  // タブ4：SNS・外部リンク管理
  // --------------------------------------------------------------------------
  async function loadLinks() {
    try {
      const data = await apiFetch('/api/admin/links');
      state.links = data.links || [];
      renderLinksAdmin();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderLinksAdmin() {
    const tbody = document.getElementById('links-tbody');
    const mobileList = document.getElementById('links-mobile-list');
    if (!state.links.length) {
      tbody.innerHTML =
        '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted);">リンクが登録されていません。</td></tr>';
      mobileList.innerHTML = '<div class="empty-box">リンクが登録されていません。</div>';
      return;
    }

    tbody.innerHTML = state.links
      .map(
        (l) => `
          <tr>
            <td>${l.sort_order}</td>
            <td><strong>${escapeHtml(l.title)}</strong></td>
            <td><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.url)}</a></td>
            <td>${escapeHtml(l.description || '-')}</td>
            <td style="white-space:nowrap;">
              <button type="button" class="btn btn-secondary btn-sm edit-link-btn" data-id="${escapeHtml(l.id)}">編集</button>
              <button type="button" class="btn btn-danger-outline btn-sm delete-link-btn" data-id="${escapeHtml(l.id)}">削除</button>
            </td>
          </tr>
        `
      )
      .join('');

    mobileList.innerHTML = state.links
      .map(
        (l) => `
          <div class="link-mobile-card">
            <div class="res-mobile-head">
              <strong>${escapeHtml(l.title)}</strong>
              <span class="slot-tag">順: ${l.sort_order}</span>
            </div>
            <div style="font-size:12px;word-break:break-all;margin:4px 0;">
              <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.url)}</a>
            </div>
            ${l.description ? `<p style="margin:4px 0 10px;font-size:13px;color:var(--text-muted);">${escapeHtml(l.description)}</p>` : ''}
            <div style="display:flex;gap:8px;margin-top:8px;">
              <button type="button" class="btn btn-secondary btn-sm edit-link-btn" style="flex:1;" data-id="${escapeHtml(l.id)}">編集</button>
              <button type="button" class="btn btn-danger-outline btn-sm delete-link-btn" style="flex:1;" data-id="${escapeHtml(l.id)}">削除</button>
            </div>
          </div>
        `
      )
      .join('');

    const bindLinkButtons = (rootEl) => {
      rootEl.querySelectorAll('.edit-link-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = state.links.find((l) => l.id === btn.dataset.id);
          if (target) openLinkModal(target);
        });
      });

      rootEl.querySelectorAll('.delete-link-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = state.links.find((l) => l.id === btn.dataset.id);
          if (!target) return;
          openConfirmDialog({
            title: '外部リンクの削除確認',
            message: `リンク「${target.title}」を削除しますか？`,
            yesClass: 'btn-danger',
            onConfirm: async () => {
              await apiFetch(`/api/admin/links/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
              showToast('リンクを削除しました。', 'success');
              await loadLinks();
            },
          });
        });
      });
    };

    bindLinkButtons(tbody);
    bindLinkButtons(mobileList);
  }

  function openLinkModal(link = null) {
    document.getElementById('link-form-error').classList.add('hidden');
    if (link) {
      document.getElementById('link-modal-title').textContent = 'リンクを編集';
      document.getElementById('link-id').value = link.id;
      document.getElementById('link-title').value = link.title;
      document.getElementById('link-url').value = link.url;
      document.getElementById('link-description').value = link.description || '';
      document.getElementById('link-sort-order').value = link.sort_order ?? 0;
    } else {
      document.getElementById('link-modal-title').textContent = '新規リンクを追加';
      document.getElementById('link-id').value = '';
      document.getElementById('link-form').reset();
      document.getElementById('link-sort-order').value = state.links.length + 1;
    }
    document.getElementById('link-modal').classList.remove('hidden');
  }

  // --------------------------------------------------------------------------
  // 管理画面表示モード切替（自動 / PC / スマホ）＆ 公開画面プレビュー
  // --------------------------------------------------------------------------
  const VIEW_MODE_STORAGE_KEY = 'artyhub_admin_view_mode';

  function applyAdminViewMode(mode, persist = true) {
    const valid = ['auto', 'desktop', 'mobile'].includes(mode) ? mode : 'auto';
    document.body.classList.remove('view-mode-desktop', 'view-mode-mobile');
    if (valid === 'desktop') document.body.classList.add('view-mode-desktop');
    if (valid === 'mobile') document.body.classList.add('view-mode-mobile');

    document.querySelectorAll('[data-view-mode]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.viewMode === valid);
    });

    if (persist) {
      try {
        localStorage.setItem(VIEW_MODE_STORAGE_KEY, valid);
      } catch {}
    }
  }

  function loadSavedAdminViewMode() {
    try {
      const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (saved) applyAdminViewMode(saved, false);
    } catch {}
  }

  function setPreviewDevice(device) {
    const isDesktop = device === 'desktop';
    const shell = document.getElementById('preview-frame-shell');
    shell.classList.toggle('is-desktop', isDesktop);
    shell.classList.toggle('is-mobile', !isDesktop);
    document.getElementById('preview-mobile-btn').classList.toggle('is-active', !isDesktop);
    document.getElementById('preview-desktop-btn').classList.toggle('is-active', isDesktop);
  }

  function reloadPublicPreview() {
    const iframe = document.getElementById('preview-iframe');
    iframe.src = `/?preview=${Date.now()}`;
  }

  function openPublicPreview(defaultDevice = 'mobile') {
    setPreviewDevice(defaultDevice);
    reloadPublicPreview();
    document.getElementById('preview-modal').classList.remove('hidden');
  }

  // --------------------------------------------------------------------------
  // イベントリスナー登録
  // --------------------------------------------------------------------------
  function bindEvents() {
    // ログイン
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('login-error');
      errEl.classList.add('hidden');
      const password = document.getElementById('admin-password').value;

      try {
        await apiFetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        document.getElementById('admin-password').value = '';
        const session = await apiFetch('/api/admin/session');
        await showDashboardView(session);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    });

    // ログアウト
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
      showLoginView();
    });

    // 管理画面の表示モード切替（自動 / PC / スマホ）
    document.querySelectorAll('[data-view-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyAdminViewMode(btn.dataset.viewMode, true);
      });
    });

    // お客様向け公開画面プレビュー（スマホ／PC切替）
    document.getElementById('open-preview-btn').addEventListener('click', () => {
      const defaultDevice = document.body.classList.contains('view-mode-desktop') ? 'desktop' : 'mobile';
      openPublicPreview(defaultDevice);
    });
    document.getElementById('preview-mobile-btn').addEventListener('click', () => {
      setPreviewDevice('mobile');
    });
    document.getElementById('preview-desktop-btn').addEventListener('click', () => {
      setPreviewDevice('desktop');
    });
    document.getElementById('preview-reload-btn').addEventListener('click', reloadPublicPreview);

    // タブ切替
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // 共通モーダル閉じるボタン
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById(btn.dataset.closeModal).classList.add('hidden');
      });
    });

    // 2段階確認ダイアログボタン（「はい」「いいえ」）
    document.getElementById('confirm-no-btn').addEventListener('click', () => {
      closeConfirmDialog();
    });

    document.getElementById('confirm-yes-btn').addEventListener('click', async () => {
      const cb = state.confirmCallback;
      if (!cb) {
        closeConfirmDialog();
        return;
      }
      const yesBtn = document.getElementById('confirm-yes-btn');
      yesBtn.disabled = true;
      yesBtn.textContent = '処理中...';
      try {
        await cb();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        closeConfirmDialog();
      }
    });

    // タブ1：月切替・フィルタ
    document.getElementById('res-prev-month').addEventListener('click', () => {
      state.resMonth -= 1;
      if (state.resMonth < 1) {
        state.resMonth = 12;
        state.resYear -= 1;
      }
      state.selectedResDate = null;
      loadReservations();
    });

    document.getElementById('res-next-month').addEventListener('click', () => {
      state.resMonth += 1;
      if (state.resMonth > 12) {
        state.resMonth = 1;
        state.resYear += 1;
      }
      state.selectedResDate = null;
      loadReservations();
    });

    document.getElementById('res-today-month').addEventListener('click', () => {
      const now = new Date();
      state.resYear = now.getFullYear();
      state.resMonth = now.getMonth() + 1;
      state.selectedResDate = null;
      loadReservations();
    });

    document.getElementById('res-filter-status').addEventListener('change', (e) => {
      state.filterStatus = e.target.value;
      loadReservations();
    });

    document.getElementById('res-filter-content').addEventListener('change', (e) => {
      state.filterContentId = e.target.value;
      loadReservations();
    });

    document.getElementById('res-refresh-btn').addEventListener('click', loadReservations);

    document.getElementById('add-manual-res-btn').addEventListener('click', () => {
      openReservationEditModal(null, state.selectedResDate);
    });

    document.getElementById('res-add-selected-date-btn').addEventListener('click', () => {
      openReservationEditModal(null, state.selectedResDate);
    });

    document.getElementById('res-clear-date-btn').addEventListener('click', () => {
      state.selectedResDate = null;
      renderAdminCalendar();
      renderReservationsTable();
    });

    // 予約詳細モーダル：内容を編集
    document.getElementById('btn-edit-reservation').addEventListener('click', () => {
      const r = state.activeReservation;
      if (!r) return;
      document.getElementById('reservation-modal').classList.add('hidden');
      openReservationEditModal(r);
    });

    // 電話・手動予約追加＆編集モーダル内イベント
    document.getElementById('res-edit-content').addEventListener('change', () => {
      updateManualPricePreview();
      loadManualDaySlots();
    });
    document.getElementById('res-edit-date').addEventListener('change', loadManualDaySlots);
    document.getElementById('res-edit-time').addEventListener('input', renderManualSlotChips);
    document.getElementById('res-edit-people').addEventListener('input', updateManualPricePreview);

    document.getElementById('reservation-edit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('res-edit-error');
      errEl.classList.add('hidden');

      const id = document.getElementById('res-edit-id').value;
      const reservationDate = document.getElementById('res-edit-date').value;
      const payload = {
        content_id: document.getElementById('res-edit-content').value,
        reservation_date: reservationDate,
        time_slot: document.getElementById('res-edit-time').value,
        status: document.getElementById('res-edit-status').value,
        people_count: Number(document.getElementById('res-edit-people').value),
        customer_name: document.getElementById('res-edit-name').value.trim(),
        customer_phone: document.getElementById('res-edit-phone').value.trim(),
        customer_email: document.getElementById('res-edit-email').value.trim(),
        notes: document.getElementById('res-edit-notes').value.trim(),
        sendConfirmationEmail: document.getElementById('res-edit-send-mail').checked,
      };

      const saveBtn = document.getElementById('res-edit-save-btn');
      saveBtn.disabled = true;

      try {
        if (id) {
          await apiFetch(`/api/admin/reservations/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          showToast('予約内容を更新しました。', 'success');
        } else {
          const res = await apiFetch('/api/admin/reservations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          let msg = res.wasOverbooked
            ? '満席／枠外の時間帯へ強制追加しました。'
            : '電話・手動予約を登録しました。';
          if (res.mail?.sent) {
            msg += ' 確定メールを送信しました。';
          }
          showToast(msg, 'success');
        }

        document.getElementById('reservation-edit-modal').classList.add('hidden');

        // 登録・変更した日付の年月へカレンダー表示を合わせる
        if (reservationDate) {
          const [y, m] = reservationDate.split('-').map(Number);
          if (y && m) {
            state.resYear = y;
            state.resMonth = m;
            state.selectedResDate = reservationDate;
          }
        }
        await loadReservations();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      } finally {
        saveBtn.disabled = false;
      }
    });

    // 予約詳細モーダル：予約を受け入れる（2段階確認 必須）
    document.getElementById('btn-accept-reservation').addEventListener('click', () => {
      const r = state.activeReservation;
      if (!r) return;
      openConfirmDialog({
        title: '予約受け入れの最終確認',
        message: '本当にこの予約を受け入れますか？（お客様へ確定メールが送信されます）',
        summaryHtml: `
          <strong>${escapeHtml(r.content_title)}</strong><br/>
          日時：${formatDateJa(r.reservation_date)} ${escapeHtml(r.time_slot)}<br/>
          お客様：${escapeHtml(r.customer_name)} 様（${r.people_count}名）
        `,
        yesClass: 'btn-success',
        onConfirm: () => updateReservationStatus(r, '確定', true),
      });
    });

    // 予約詳細モーダル：来店済にする
    document.getElementById('btn-visited-reservation').addEventListener('click', () => {
      const r = state.activeReservation;
      if (!r) return;
      updateReservationStatus(r, '来店済', false);
    });

    // 予約詳細モーダル：キャンセルにする（2段階確認 必須）
    document.getElementById('btn-cancel-reservation').addEventListener('click', () => {
      const r = state.activeReservation;
      if (!r) return;
      openConfirmDialog({
        title: '予約キャンセルの最終確認',
        message: '本当にこの予約をキャンセルしますか？（この枠は再び予約可能になります）',
        summaryHtml: `
          <strong>${escapeHtml(r.content_title)}</strong><br/>
          日時：${formatDateJa(r.reservation_date)} ${escapeHtml(r.time_slot)}<br/>
          お客様：${escapeHtml(r.customer_name)} 様（${r.people_count}名）
        `,
        yesClass: 'btn-danger',
        onConfirm: () => updateReservationStatus(r, 'キャンセル', false),
      });
    });

    // タブ2：商材管理イベント
    document.getElementById('add-content-btn').addEventListener('click', () => openContentModal(null));
    document.getElementById('content-description').addEventListener('input', updateDescCounter);
    document.getElementById('content-image-url').addEventListener('input', (e) => {
      updateImagePreview(e.target.value.trim());
    });

    document.getElementById('content-image-file').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const statusText = document.getElementById('upload-status-text');
      statusText.textContent = 'アップロード中...';
      try {
        const fd = new FormData();
        fd.append('image', file);
        const res = await apiFetch('/api/admin/upload', {
          method: 'POST',
          body: fd,
        });
        document.getElementById('content-image-url').value = res.url;
        updateImagePreview(res.url);
        statusText.textContent = 'アップロード完了！';
        showToast('画像をアップロードしました。', 'success');
      } catch (err) {
        statusText.textContent = `失敗: ${err.message}`;
        showToast(err.message, 'error');
      }
    });

    document.getElementById('content-add-slot-btn').addEventListener('click', () => {
      appendNewSlotRow('content-slots-config');
    });

    document.getElementById('slots-select-all').addEventListener('click', () => {
      renderSlotConfigurator(
        'content-slots-config',
        state.timeSlots.map((time) => ({ time, max_groups: 2 }))
      );
    });

    document.getElementById('slots-clear-all').addEventListener('click', () => {
      renderSlotConfigurator('content-slots-config', [], null, false, { usePresetWhenEmpty: false });
    });

    document.getElementById('content-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('content-form-error');
      errEl.classList.add('hidden');

      const parsedSlots = readSlotConfigurator('content-slots-config');
      if (parsedSlots.error) {
        errEl.textContent = parsedSlots.error;
        errEl.classList.remove('hidden');
        return;
      }

      const id = document.getElementById('content-id').value;
      const payload = {
        title: document.getElementById('content-title').value.trim(),
        price: Number(document.getElementById('content-price').value),
        max_people_per_group: Number(document.getElementById('content-max-people').value),
        image_url: document.getElementById('content-image-url').value.trim(),
        description: document.getElementById('content-description').value.trim(),
        default_time_slots: parsedSlots.slots,
        sort_order: Number(document.getElementById('content-sort-order').value) || 0,
        is_active: document.getElementById('content-is-active').checked,
      };

      try {
        if (id) {
          await apiFetch(`/api/admin/contents/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          showToast('商材を更新しました。', 'success');
        } else {
          await apiFetch('/api/admin/contents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          showToast('商材を追加しました。', 'success');
        }
        document.getElementById('content-modal').classList.add('hidden');
        await loadContents();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    });

    // タブ3：日別スケジュールイベント
    document.getElementById('daily-content-select').addEventListener('change', loadDailyScheduleDetail);
    document.getElementById('daily-date-input').addEventListener('change', loadDailyScheduleDetail);

    document.getElementById('daily-add-slot-btn').addEventListener('click', () => {
      if (document.getElementById('daily-closed-checkbox').checked) return;
      appendNewSlotRow('daily-slots-config');
    });

    document.getElementById('daily-preset-slots-btn').addEventListener('click', () => {
      if (document.getElementById('daily-closed-checkbox').checked) return;
      renderSlotConfigurator(
        'daily-slots-config',
        state.timeSlots.map((time) => ({ time, max_groups: 2 }))
      );
    });

    document.getElementById('daily-closed-checkbox').addEventListener('change', (e) => {
      const closed = e.target.checked;
      setDailySlotButtonsDisabled(closed);
      if (closed) {
        renderSlotConfigurator('daily-slots-config', [], null, true);
      } else {
        const content = state.contents.find((c) => c.id === document.getElementById('daily-content-select').value);
        const fallback = content ? content.default_time_slots : [];
        renderSlotConfigurator('daily-slots-config', fallback, null, false, { usePresetWhenEmpty: true });
      }
    });

    document.getElementById('daily-save-btn').addEventListener('click', async () => {
      const content_id = document.getElementById('daily-content-select').value;
      const target_date = document.getElementById('daily-date-input').value;
      const isClosed = document.getElementById('daily-closed-checkbox').checked;
      if (!content_id || !target_date) {
        showToast('商材と日付を選択してください。', 'error');
        return;
      }

      let custom_time_slots = [];
      if (!isClosed) {
        const parsedSlots = readSlotConfigurator('daily-slots-config');
        if (parsedSlots.error) {
          showToast(parsedSlots.error, 'error');
          return;
        }
        custom_time_slots = parsedSlots.slots;
      }

      try {
        await apiFetch('/api/admin/daily-schedules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content_id, target_date, custom_time_slots }),
        });
        showToast(
          isClosed ? `${target_date} を受付停止として保存しました。` : `${target_date} の予約枠を保存しました。`,
          'success'
        );
        await loadDailySchedulesAndDetail();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    document.getElementById('daily-reset-btn').addEventListener('click', async () => {
      const contentId = document.getElementById('daily-content-select').value;
      const date = document.getElementById('daily-date-input').value;
      if (!contentId || !date) return;
      try {
        await apiFetch(
          `/api/admin/daily-schedules?contentId=${encodeURIComponent(contentId)}&date=${encodeURIComponent(date)}`,
          { method: 'DELETE' }
        );
        showToast('通常設定に戻しました。', 'success');
        await loadDailySchedulesAndDetail();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // タブ4：外部リンクイベント
    document.getElementById('add-link-btn').addEventListener('click', () => openLinkModal(null));

    document.getElementById('link-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('link-form-error');
      errEl.classList.add('hidden');

      const id = document.getElementById('link-id').value;
      const payload = {
        title: document.getElementById('link-title').value.trim(),
        url: document.getElementById('link-url').value.trim(),
        description: document.getElementById('link-description').value.trim(),
        sort_order: Number(document.getElementById('link-sort-order').value) || 0,
      };

      try {
        if (id) {
          await apiFetch(`/api/admin/links/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          showToast('リンクを更新しました。', 'success');
        } else {
          await apiFetch('/api/admin/links', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          showToast('リンクを追加しました。', 'success');
        }
        document.getElementById('link-modal').classList.add('hidden');
        await loadLinks();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    });
  }

  async function init() {
    loadSavedAdminViewMode();
    bindEvents();
    try {
      const session = await apiFetch('/api/admin/session');
      if (session.storeName) {
        document.getElementById('login-store-title').textContent = `${session.storeName} 管理画面`;
      }
      if (session.authenticated) {
        await showDashboardView(session);
      } else {
        showLoginView();
      }
    } catch {
      showLoginView();
    }
  }

  init();
})();
