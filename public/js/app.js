(() => {
  const state = {
    storeName: 'ARTYHUB 長野',
    today: '',
    contents: [],
    selectedContentId: null,
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth() + 1,
    monthData: null,
    selectedDate: null,
    selectedTimeSlot: null,
    isSubmitting: false,
  };

  const els = {
    headerStoreName: document.getElementById('header-store-name'),
    heroStoreName: document.getElementById('hero-store-name'),
    footerStoreName: document.getElementById('footer-store-name'),
    contentsGrid: document.getElementById('contents-grid'),
    contentSelect: document.getElementById('booking-content-select'),
    selectedContentMeta: document.getElementById('selected-content-meta'),
    calPrevBtn: document.getElementById('cal-prev-btn'),
    calNextBtn: document.getElementById('cal-next-btn'),
    calMonthLabel: document.getElementById('cal-month-label'),
    calendarGrid: document.getElementById('calendar-grid'),
    selectedDateBadge: document.getElementById('selected-date-badge'),
    slotsContainer: document.getElementById('slots-container'),
    bookingSummaryBox: document.getElementById('booking-summary-box'),
    form: document.getElementById('reservation-form'),
    peopleSelect: document.getElementById('people-count'),
    totalPriceDisplay: document.getElementById('total-price-display'),
    customerName: document.getElementById('customer-name'),
    customerEmail: document.getElementById('customer-email'),
    customerPhone: document.getElementById('customer-phone'),
    customerNotes: document.getElementById('customer-notes'),
    formError: document.getElementById('form-error'),
    submitBtn: document.getElementById('submit-reservation-btn'),
    bookingWorkspace: document.getElementById('booking-workspace'),
    bookingComplete: document.getElementById('booking-complete'),
    completeDetails: document.getElementById('complete-details'),
    bookAgainBtn: document.getElementById('book-again-btn'),
    linksGrid: document.getElementById('links-grid'),
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

  function formatPeopleRange(minPeople, maxPeople) {
    const min = Number(minPeople) || 1;
    const max = Number(maxPeople) || min;
    if (min === max) return `1組 ${min}名`;
    return `1組 ${min}〜${max}名`;
  }

  function formatDateJa(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const wds = ['日', '月', '火', '水', '木', '金', '土'];
    return `${y}年${m}月${d}日（${wds[dt.getUTCDay()]}）`;
  }

  function getSelectedContent() {
    return state.contents.find((c) => c.id === state.selectedContentId) || null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isJwtFutureMessage(msg) {
    return /PGRST303|JWT issued at future/i.test(String(msg || ''));
  }

  async function apiFetch(url, options = {}, { maxRetries = 3, delayMs = 1000 } = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const isReadMethod = method === 'GET' || method === 'HEAD';
    let lastErr = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, options);
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          return data;
        }

        const errMsg = data.error || '通信エラーが発生しました。';
        const err = new Error(errMsg);
        err.status = res.status;

        const shouldRetry =
          attempt < maxRetries &&
          (isJwtFutureMessage(errMsg) || (isReadMethod && res.status >= 500));

        if (shouldRetry) {
          await sleep(delayMs);
          continue;
        }
        throw err;
      } catch (err) {
        lastErr = err;
        const isNetworkError = err && !err.status;
        const shouldRetry =
          attempt < maxRetries &&
          ((isReadMethod && (isNetworkError || err.status >= 500)) ||
            isJwtFutureMessage(err?.message));

        if (shouldRetry) {
          await sleep(delayMs);
          continue;
        }
        throw err;
      }
    }

    throw lastErr || new Error('通信エラーが発生しました。');
  }

  // --------------------------------------------------------------------------
  // 商材一覧レンダリング
  // --------------------------------------------------------------------------
  function renderContents() {
    if (!state.contents.length) {
      els.contentsGrid.innerHTML =
        '<div class="empty-state">現在公開中の体験メニューはありません。準備が整い次第公開いたします。</div>';
      els.contentSelect.innerHTML = '<option value="">メニューなし</option>';
      return;
    }

    els.contentsGrid.innerHTML = state.contents
      .map((c) => {
        const isSelected = c.id === state.selectedContentId;
        const mediaHtml = c.image_url
          ? `<img src="${escapeHtml(c.image_url)}" alt="${escapeHtml(c.title)}" loading="lazy" />`
          : `<div class="content-placeholder">
               <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                 <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor"></circle>
                 <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor"></circle>
                 <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor"></circle>
                 <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor"></circle>
                 <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path>
               </svg>
               <span style="font-size:12px;font-weight:600;">ARTYHUB WORKSHOP</span>
             </div>`;

        return `
          <article class="content-card ${isSelected ? 'is-selected' : ''}">
            <div class="content-media">${mediaHtml}</div>
            <div class="content-body">
              <h3 class="content-title">${escapeHtml(c.title)}</h3>
              <div class="content-meta">
                <span class="meta-pill price">${formatYen(c.price)} / 1名</span>
                <span class="meta-pill">${formatPeopleRange(c.min_people_per_group, c.max_people_per_group)}</span>
              </div>
              <p class="content-desc">${escapeHtml(c.description || '初心者の方も気軽に楽しめるアート体験です。')}</p>
              <button
                type="button"
                class="btn ${isSelected ? 'btn-primary' : 'btn-secondary'} btn-block select-content-btn"
                data-content-id="${escapeHtml(c.id)}"
              >
                ${isSelected ? '選択中・空き状況を見る' : 'この体験を予約する'}
              </button>
            </div>
          </article>
        `;
      })
      .join('');

    els.contentsGrid.querySelectorAll('.select-content-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.contentId;
        selectContent(id, true);
      });
    });

    // セレクトボックス同期
    els.contentSelect.innerHTML = state.contents
      .map(
        (c) =>
          `<option value="${escapeHtml(c.id)}" ${c.id === state.selectedContentId ? 'selected' : ''}>
            ${escapeHtml(c.title)}（${formatYen(c.price)} / 1名）
          </option>`
      )
      .join('');

    renderSelectedContentMeta();
  }

  function renderSelectedContentMeta() {
    const content = getSelectedContent();
    if (!content) {
      els.selectedContentMeta.innerHTML = '';
      return;
    }
    const minPeople = Number(content.min_people_per_group) || 1;
    const maxPeople = Math.max(minPeople, Number(content.max_people_per_group) || minPeople);

    els.selectedContentMeta.innerHTML = `
      <span class="meta-pill price">${formatYen(content.price)} / 1名</span>
      <span class="meta-pill">${formatPeopleRange(minPeople, maxPeople)}</span>
    `;

    // 参加人数セレクト更新（最低人数〜上限人数）
    const prevVal = Number(els.peopleSelect.value) || minPeople;
    const clamped = Math.min(Math.max(prevVal, minPeople), maxPeople);
    let optionsHtml = '';
    for (let i = minPeople; i <= maxPeople; i++) {
      optionsHtml += `<option value="${i}" ${i === clamped ? 'selected' : ''}>${i}名</option>`;
    }
    els.peopleSelect.innerHTML = optionsHtml;
    els.peopleSelect.disabled = false;
    updateTotalPrice();
  }

  async function selectContent(contentId, shouldScroll = false) {
    state.selectedContentId = contentId;
    state.selectedDate = null;
    state.selectedTimeSlot = null;
    els.bookingComplete.classList.add('hidden');
    els.bookingWorkspace.classList.remove('hidden');

    renderContents();
    renderSlots();
    updateBookingSummary();

    if (shouldScroll) {
      document.getElementById('booking-section').scrollIntoView({ behavior: 'smooth' });
    }

    await loadMonthAvailability();
  }

  // --------------------------------------------------------------------------
  // 月別空き状況カレンダー
  // --------------------------------------------------------------------------
  async function loadMonthAvailability() {
    const content = getSelectedContent();
    if (!content) {
      els.calendarGrid.innerHTML = '';
      return;
    }

    els.calMonthLabel.textContent = `${state.currentYear}年${state.currentMonth}月`;
    els.calendarGrid.innerHTML =
      '<div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--text-muted);">空き状況を読み込んでいます...</div>';

    try {
      const data = await apiFetch(
        `/api/availability?contentId=${encodeURIComponent(content.id)}&year=${state.currentYear}&month=${state.currentMonth}`
      );
      state.monthData = data;
      renderCalendar();

      // 選択中の日付が今月に属していれば枠を再描画
      if (state.selectedDate) {
        const stillExists = data.days.some((d) => d.date === state.selectedDate);
        if (!stillExists) {
          state.selectedDate = null;
          state.selectedTimeSlot = null;
        }
      }
      renderSlots();
      updateBookingSummary();
    } catch (err) {
      els.calendarGrid.innerHTML = `
        <div style="grid-column:1/-1;" class="alert alert-error">
          <div>${escapeHtml(err.message)}</div>
          <button type="button" id="retry-calendar-btn" class="btn btn-secondary" style="margin-top:10px;">
            空き状況を再読み込みする
          </button>
        </div>
      `;
      const retryCalBtn = document.getElementById('retry-calendar-btn');
      if (retryCalBtn) {
        retryCalBtn.addEventListener('click', loadMonthAvailability);
      }
    }
  }

  function renderCalendar() {
    if (!state.monthData) return;
    const { year, month, days } = state.monthData;
    const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();

    let html = '';
    for (let i = 0; i < firstWeekday; i++) {
      html += '<div class="cal-cell is-empty" aria-hidden="true"></div>';
    }

    const markMap = {
      available: '○',
      few: '△',
      full: '×',
      closed: '－',
      past: '－',
    };

    for (const day of days) {
      const dayNum = Number(day.date.split('-')[2]);
      const isSelectable = day.status === 'available' || day.status === 'few';
      const isSelected = state.selectedDate === day.date;
      const mark = markMap[day.status] || '－';

      html += `
        <button
          type="button"
          class="cal-cell ${isSelected ? 'is-selected' : ''}"
          data-date="${day.date}"
          ${isSelectable ? '' : 'disabled'}
          aria-label="${formatDateJa(day.date)} ${day.status === 'available' ? '空きあり' : day.status === 'few' ? '残りわずか' : '予約不可'}"
        >
          <span class="cal-day-num">${dayNum}</span>
          <span class="cal-mark ${day.status}">${mark}</span>
        </button>
      `;
    }

    els.calendarGrid.innerHTML = html;
    els.calendarGrid.querySelectorAll('.cal-cell[data-date]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedDate = btn.dataset.date;
        state.selectedTimeSlot = null;
        renderCalendar();
        renderSlots();
        updateBookingSummary();
      });
    });
  }

  // --------------------------------------------------------------------------
  // 日別時間帯スロット
  // --------------------------------------------------------------------------
  function renderSlots() {
    if (!state.selectedDate || !state.monthData) {
      els.selectedDateBadge.textContent = '';
      els.slotsContainer.innerHTML =
        '<p class="slots-hint">左のカレンダーからご予約可能な日付を選択してください。</p>';
      return;
    }

    els.selectedDateBadge.textContent = formatDateJa(state.selectedDate);
    const dayInfo = state.monthData.days.find((d) => d.date === state.selectedDate);

    if (!dayInfo || !dayInfo.slots.length) {
      els.slotsContainer.innerHTML =
        '<p class="slots-hint">この日は開催枠がありません。別の日付をお選びください。</p>';
      return;
    }

    els.slotsContainer.innerHTML = `
      <div class="slots-grid">
        ${dayInfo.slots
          .map((slot) => {
            const isSelected = state.selectedTimeSlot === slot.time;
            const remainText = slot.is_available ? `残り${slot.remaining_groups}組` : '満席';
            const remainClass = !slot.is_available
              ? 'is-full'
              : slot.remaining_groups === 1
                ? 'is-few'
                : '';

            return `
              <button
                type="button"
                class="slot-btn ${isSelected ? 'is-selected' : ''}"
                data-time="${escapeHtml(slot.time)}"
                ${slot.is_available ? '' : 'disabled'}
              >
                <span class="slot-time">${escapeHtml(slot.time)}</span>
                <span class="slot-remain ${remainClass}">${remainText}</span>
              </button>
            `;
          })
          .join('')}
      </div>
    `;

    els.slotsContainer.querySelectorAll('.slot-btn[data-time]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedTimeSlot = btn.dataset.time;
        renderSlots();
        updateBookingSummary();
      });
    });
  }

  function updateTotalPrice() {
    const content = getSelectedContent();
    const count = Number(els.peopleSelect.value) || 1;
    const total = content ? content.price * count : 0;
    els.totalPriceDisplay.textContent = formatYen(total);
  }

  function updateBookingSummary() {
    const content = getSelectedContent();
    const ready = Boolean(content && state.selectedDate && state.selectedTimeSlot);
    els.submitBtn.disabled = !ready || state.isSubmitting;

    if (ready) {
      els.bookingSummaryBox.classList.remove('hidden');
      els.bookingSummaryBox.innerHTML = `
        選択中：<strong>${escapeHtml(content.title)}</strong> ／
        <strong>${formatDateJa(state.selectedDate)} ${escapeHtml(state.selectedTimeSlot)}</strong>
      `;
    } else {
      els.bookingSummaryBox.classList.add('hidden');
      els.bookingSummaryBox.innerHTML = '';
    }
  }

  function showFormError(msg) {
    if (!msg) {
      els.formError.classList.add('hidden');
      els.formError.textContent = '';
      return;
    }
    els.formError.textContent = msg;
    els.formError.classList.remove('hidden');
  }

  // --------------------------------------------------------------------------
  // 予約送信
  // --------------------------------------------------------------------------
  async function handleSubmit(e) {
    e.preventDefault();
    showFormError('');

    const content = getSelectedContent();
    if (!content || !state.selectedDate || !state.selectedTimeSlot) {
      showFormError('体験メニュー・日付・時間帯を選択してください。');
      return;
    }

    const payload = {
      content_id: content.id,
      reservation_date: state.selectedDate,
      time_slot: state.selectedTimeSlot,
      people_count: Number(els.peopleSelect.value),
      customer_name: els.customerName.value.trim(),
      customer_email: els.customerEmail.value.trim(),
      customer_phone: els.customerPhone.value.trim(),
      notes: els.customerNotes.value.trim(),
    };

    if (!payload.customer_name) {
      showFormError('お名前を入力してください。');
      els.customerName.focus();
      return;
    }
    if (!payload.customer_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.customer_email)) {
      showFormError('有効なメールアドレスを入力してください。');
      els.customerEmail.focus();
      return;
    }
    if (!payload.customer_phone) {
      showFormError('お電話番号を入力してください。');
      els.customerPhone.focus();
      return;
    }

    state.isSubmitting = true;
    els.submitBtn.disabled = true;
    els.submitBtn.textContent = '送信中...';

    try {
      const res = await apiFetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const r = res.reservation;
      els.completeDetails.innerHTML = `
        <div class="detail-row"><span class="detail-key">体験メニュー</span><span class="detail-val">${escapeHtml(r.content_title)}</span></div>
        <div class="detail-row"><span class="detail-key">ご希望日時</span><span class="detail-val">${formatDateJa(r.reservation_date)} ${escapeHtml(r.time_slot)}</span></div>
        <div class="detail-row"><span class="detail-key">参加人数</span><span class="detail-val">${r.people_count}名</span></div>
        <div class="detail-row"><span class="detail-key">合計金額</span><span class="detail-val">${formatYen(r.total_price)}</span></div>
        <div class="detail-row"><span class="detail-key">お名前</span><span class="detail-val">${escapeHtml(r.customer_name)} 様</span></div>
        <div class="detail-row"><span class="detail-key">メール</span><span class="detail-val">${escapeHtml(r.customer_email)}</span></div>
        <div class="detail-row"><span class="detail-key">お電話番号</span><span class="detail-val">${escapeHtml(r.customer_phone)}</span></div>
        <div class="detail-row"><span class="detail-key">受付状態</span><span class="detail-val">仮予約（確認待ち）</span></div>
      `;

      els.bookingWorkspace.classList.add('hidden');
      els.bookingComplete.classList.remove('hidden');
      els.form.reset();
      state.selectedTimeSlot = null;
      await loadMonthAvailability();
      document.getElementById('booking-section').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      showFormError(err.message);
      // 満席等で失敗した場合に最新空き状況を再読み込み
      await loadMonthAvailability();
    } finally {
      state.isSubmitting = false;
      els.submitBtn.textContent = 'この内容で仮予約を申し込む';
      updateBookingSummary();
    }
  }

  // --------------------------------------------------------------------------
  // 外部リンク・SNS
  // --------------------------------------------------------------------------
  function getLinkBadgeMeta(link) {
    const text = `${link.title} ${link.url}`.toLowerCase();
    if (text.includes('instagram')) return { cls: 'instagram', label: 'IG' };
    if (text.includes('tiktok')) return { cls: 'tiktok', label: 'TT' };
    if (text.includes('map') || text.includes('マップ') || text.includes('アクセス')) {
      return { cls: 'map', label: 'MAP' };
    }
    if (text.includes('line')) return { cls: 'line', label: 'LINE' };
    if (text.includes('youtube')) return { cls: 'youtube', label: 'YT' };
    return { cls: '', label: 'WEB' };
  }

  function renderLinks(links) {
    if (!links.length) {
      els.linksGrid.innerHTML = '<div class="empty-state">現在登録されているリンクはありません。</div>';
      return;
    }

    els.linksGrid.innerHTML = links
      .map((l) => {
        const badge = getLinkBadgeMeta(l);
        return `
          <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer" class="link-card">
            <div class="link-card-head">
              <span class="link-icon-wrap">
                <span class="link-badge ${badge.cls}">${badge.label}</span>
                <span>${escapeHtml(l.title)}</span>
              </span>
              <span class="link-arrow" aria-hidden="true">↗</span>
            </div>
            ${l.description ? `<p class="link-desc">${escapeHtml(l.description)}</p>` : ''}
          </a>
        `;
      })
      .join('');
  }

  // --------------------------------------------------------------------------
  // 初期化
  // --------------------------------------------------------------------------
  async function loadInitialData() {
    els.contentsGrid.innerHTML = '<div class="empty-state">メニューを読み込んでいます...</div>';
    try {
      const [cfg, contentsRes] = await Promise.all([
        apiFetch('/api/config'),
        apiFetch('/api/contents'),
      ]);

      state.storeName = cfg.storeName || 'ARTYHUB 長野';
      state.today = cfg.today;
      document.title = `${state.storeName} | ワークショップ体験予約`;
      els.headerStoreName.textContent = state.storeName;
      els.heroStoreName.textContent = state.storeName;
      els.footerStoreName.textContent = state.storeName;

      if (cfg.today) {
        const [y, m] = cfg.today.split('-').map(Number);
        state.currentYear = y;
        state.currentMonth = m;
      }

      state.contents = contentsRes.contents || [];
      if (state.contents.length > 0) {
        state.selectedContentId = state.contents[0].id;
      }

      renderContents();

      // リンク取得は独立して実行（万が一失敗しても商材・予約を止めない）
      apiFetch('/api/links')
        .then((linksRes) => renderLinks(linksRes.links || []))
        .catch(() => {
          els.linksGrid.innerHTML =
            '<div class="empty-state">リンク情報の読み込みに失敗しました。ページを再読み込みしてください。</div>';
        });

      if (state.selectedContentId) {
        await loadMonthAvailability();
      }
    } catch (err) {
      els.contentsGrid.innerHTML = `
        <div class="alert alert-error" style="grid-column:1/-1;">
          <div>メニューの読み込みに失敗しました（${escapeHtml(err.message)}）</div>
          <button type="button" id="retry-contents-btn" class="btn btn-secondary" style="margin-top:10px;">
            再読み込みする
          </button>
        </div>
      `;
      const retryBtn = document.getElementById('retry-contents-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', loadInitialData);
      }
    }
  }

  async function init() {
    els.contentSelect.addEventListener('change', (e) => {
      if (e.target.value) selectContent(e.target.value, false);
    });

    els.calPrevBtn.addEventListener('click', () => {
      state.currentMonth -= 1;
      if (state.currentMonth < 1) {
        state.currentMonth = 12;
        state.currentYear -= 1;
      }
      state.selectedDate = null;
      state.selectedTimeSlot = null;
      loadMonthAvailability();
    });

    els.calNextBtn.addEventListener('click', () => {
      state.currentMonth += 1;
      if (state.currentMonth > 12) {
        state.currentMonth = 1;
        state.currentYear += 1;
      }
      state.selectedDate = null;
      state.selectedTimeSlot = null;
      loadMonthAvailability();
    });

    els.peopleSelect.addEventListener('change', updateTotalPrice);
    els.form.addEventListener('submit', handleSubmit);

    els.bookAgainBtn.addEventListener('click', () => {
      els.bookingComplete.classList.add('hidden');
      els.bookingWorkspace.classList.remove('hidden');
      renderSelectedContentMeta();
      loadMonthAvailability();
    });

    await loadInitialData();
  }

  init();
})();
