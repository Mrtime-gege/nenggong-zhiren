/** Operator queue selection, stats and rendering. */

function reconcileSelection() {
  if (state.selectedId && !state.tickets.some((ticket) => ticket.id === state.selectedId)) {
    state.selectedId = null;
  }
  if (!state.selectedId) {
    try {
      const remembered = sessionStorage.getItem(SELECTED_STORAGE_KEY);
      if (remembered && state.tickets.some((ticket) => ticket.id === remembered)) {
        state.selectedId = remembered;
      }
    } catch { /* optional */ }
  }
  if (state.selectedId) return;

  const mine = state.tickets.find((ticket) => isActive(ticket) && ticket.claimedBy === state.operator);
  const queued = state.tickets
    .filter((ticket) => ticket.state === "queued")
    .sort(queuePriority)[0];
  const active = state.tickets.filter((ticket) => isActive(ticket)).sort(queuePriority)[0];
  const chosen = mine || queued || active || state.tickets[0];
  state.selectedId = chosen ? chosen.id : null;
  rememberSelectedTicket(state.selectedId);
  if (state.selectedId && !state.drafts.has(state.selectedId)) state.drafts.set(state.selectedId, "");
}

function statChip(label, value, tone) {
  const wrap = el("div", "stat");
  wrap.append(el("span", `stat-value ${tone || ""}`.trim(), value));
  wrap.append(el("span", "stat-label", label));
  return wrap;
}

function setMobileView(view) {
  state.mobileView = view === "detail" ? "detail" : "queue";
  document.body.dataset.mobileView = state.mobileView;
  for (const button of els.mobileViewTabs?.querySelectorAll("[data-mobile-view]") || []) {
    const active = button.dataset.mobileView === state.mobileView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }
}

function updateMobileQueueCount() {
  if (!els.mobileQueueCount) return;
  const queued = state.tickets.filter((ticket) => ticket.state === "queued").length;
  els.mobileQueueCount.textContent = queued ? `(${queued})` : "";
}

function renderStats() {
  const stats = state.stats || {};
  const active = (stats.claimed || 0) + (stats.streaming || 0) + (stats.finishing || 0);
  const signature = [stats.queued, active, stats.avgClaimMs, stats.completed, stats.failed, stats.cancelled].join(":");
  if (els.stats.dataset.signature === signature) return;
  els.stats.dataset.signature = signature;
  els.stats.replaceChildren(
    statChip("待认领", stats.queued ?? 0, "amber"),
    statChip("进行中", active, "teal"),
    statChip("平均等待", stats.avgClaimMs ? fmtMs(stats.avgClaimMs) : "—", ""),
    statChip("已完成", stats.completed ?? 0, ""),
  );
}

function queueItem(ticket, group = null) {
  const active = isActive(ticket);
  const selected = group ? group.tickets.some((item) => item.id === state.selectedId) : ticket.id === state.selectedId;
  const button = el("button", `qitem${selected ? " selected" : ""}${active ? " is-live" : " recent"}`);
  button.type = "button";
  button.dataset.state = ticket.state;
  button.addEventListener("click", () => {
    state.selectedId = ticket.id;
    rememberSelectedTicket(ticket.id);
    render();
    if (window.matchMedia("(max-width: 780px)").matches) setMobileView("detail");
  });

  const top = el("div", "qitem-top");
  const model = el("span", "qitem-model", ticket.model);
  model.title = ticket.model;
  top.append(model);
  top.append(badge(STATE_LABELS[ticket.state] || ticket.state, stateTone(ticket.state)));
  top.append(el("span", "qitem-mode", ticket.stream ? "SSE" : "JSON"));
  if (ticket.sessionId) {
    const count = group?.tickets?.length || 1;
    const sessionChip = el("span", "qitem-session", count > 1 ? `会话 ${count} 轮` : `#${ticket.sessionTurn || 1}`);
    sessionChip.title = `会话 ${ticket.sessionId}`;
    top.append(sessionChip);
  }
  if (group?.queuedCount > 1) {
    top.append(el("span", "qitem-session", `${group.queuedCount} 轮待处理`));
  }
  if (Number(ticket.priority) >= 2) {
    const priority = el("span", "qitem-priority", Number(ticket.priority) === 3 ? "紧急" : "高");
    priority.dataset.priority = String(ticket.priority);
    top.append(priority);
  }
  for (const tag of (ticket.tags || []).slice(0, 3)) {
    top.append(el("span", "qitem-tag", tag));
  }
  if ((ticket.noteCount || 0) > 0) {
    top.append(el("span", "qitem-note-count", `备注 ${ticket.noteCount}`));
  }

  const rawPreview = previewOf(ticket).replace(/\s+/g, " ").trim() || "(空)";
  const preview = el("div", "qitem-preview", rawPreview.slice(0, 240));
  preview.title = rawPreview;

  const purpose = purposeOf(ticket);
  const foot = el("div", "qitem-foot");
  const caller = el("span", "qitem-caller", ticket.caller || "caller");
  caller.title = ticket.caller || "caller";
  foot.append(caller);
  const ownerName = ticket.claimedBy || ticket.preferredOperator;
  if (ownerName) {
    foot.append(el("span", "qitem-dot"));
    const owner = el("span", `qitem-owner${ticket.claimedBy ? "" : " preferred"}`, `@${ownerName}`);
    owner.title = ticket.claimedBy ? `当前回复员：${ownerName}` : `首选回复员：${ownerName}`;
    foot.append(owner);
  }
  foot.append(el("span", "qitem-dot"));
  const purposeLabel = el("span", "qitem-purpose", purpose.queueLabel);
  purposeLabel.title = purpose.detailLabel;
  purposeLabel.dataset.tone = purpose.tone;
  foot.append(purposeLabel);
  foot.append(el("span", "qitem-dot"));
  const timing = ticket.queueWaitMs !== null && ticket.queueWaitMs !== undefined ? `等 ${fmtMs(ticket.queueWaitMs)}` : fmtMs(ticket.elapsedMs);
  foot.append(el("span", "qitem-time", timing));

  button.append(top, preview, foot);
  return button;
}

function queueMatches(ticket) {
  const query = state.queueQuery.trim().toLowerCase();
  if (query) {
    const haystack = ticket.searchText || [
      ticket.id,
      ticket.model,
      ticket.claimedBy,
      ticket.caller,
      ticket.messages?.map((message) => message.content).join(" "),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (state.queueFilter === "queued") return ticket.state === "queued";
  if (state.queueFilter === "active") return isActive(ticket) && ticket.state !== "queued";
  if (state.queueFilter === "recent") return !isActive(ticket);
  if (state.queueFilter === "mine") return ticket.claimedBy === state.operator;
  return true;
}

function buildConversationGroups(tickets) {
  const groups = new Map();
  for (const ticket of tickets) {
    const key = ticket.sessionId ? `session:${ticket.sessionId}` : `ticket:${ticket.id}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, sessionId: ticket.sessionId || null, tickets: [], active: [], queued: [], done: [] };
      groups.set(key, group);
    }
    group.tickets.push(ticket);
    if (ticket.state === "queued") group.queued.push(ticket);
    else if (isActive(ticket)) group.active.push(ticket);
    else group.done.push(ticket);
  }
  for (const group of groups.values()) {
    group.tickets.sort((a, b) => a.createdAt - b.createdAt);
    group.active.sort(queuePriority);
    group.queued.sort(queuePriority);
    group.done.sort((a, b) => b.createdAt - a.createdAt);
    group.representative = group.active[0] || group.queued[0] || group.done[0] || group.tickets[0];
    group.queuedCount = group.queued.length;
    group.activeNonQueued = group.active.length > 0;
  }
  return [...groups.values()];
}

function groupMatches(group) {
  const query = state.queueQuery.trim().toLowerCase();
  if (query && !group.tickets.some((ticket) => queueMatches(ticket))) return false;
  if (state.queueFilter === "queued") return group.queued.length > 0;
  if (state.queueFilter === "active") return group.activeNonQueued;
  if (state.queueFilter === "recent") return group.tickets.some((ticket) => !isActive(ticket));
  if (state.queueFilter === "mine") return group.tickets.some((ticket) => ticket.claimedBy === state.operator);
  return true;
}

function renderQueue() {
  updateMobileQueueCount();
  const signature = JSON.stringify({
    selected: state.selectedId,
    query: state.queueQuery,
    filter: state.queueFilter,
    tickets: state.tickets.map((ticket) => [
      ticket.id, ticket.state, ticket.sessionId, ticket.sessionTurn, ticket.claimedBy,
      ticket.preferredOperator, ticket.priority, ticket.noteCount, ticket.queueWaitMs,
      ticket.tags || [], ticket.preview || "",
    ]),
  });
  if (els.queue.dataset.signature === signature) return;
  const groups = buildConversationGroups(state.tickets).filter(groupMatches);
  if (!groups.length) {
    const empty = el("div", "queue-group");
    const head = el("div", "queue-group-head");
    head.append(el("span", "", state.tickets.length ? "没有匹配" : "队列为空"));
    empty.append(head);
    empty.append(el("div", "qitem-preview", state.tickets.length ? "换一个搜索词或筛选条件。" : "等待调用方请求…"));
    els.queue.replaceChildren(empty);
    return;
  }

  const buckets = [
    {
      label: "待认领",
      items: groups.filter((group) => group.queued.length && !group.activeNonQueued)
        .sort((a, b) => queuePriority(a.representative, b.representative)),
    },
    {
      label: "进行中",
      items: groups.filter((group) => group.activeNonQueued)
        .sort((a, b) => queuePriority(a.representative, b.representative)),
    },
    {
      label: "最近结束",
      items: groups.filter((group) => !group.queued.length && !group.activeNonQueued)
        .sort((a, b) => b.representative.createdAt - a.representative.createdAt)
        .slice(0, 12),
    },
  ];

  const scrollTop = els.queue.scrollTop;
  const fragment = document.createDocumentFragment();
  for (const bucket of buckets) {
    if (!bucket.items.length) continue;
    const wrap = el("div", "queue-group");
    const head = el("div", "queue-group-head");
    head.append(el("span", "", bucket.label));
    head.append(el("span", "", String(bucket.items.length).padStart(2, "0")));
    wrap.append(head);
    for (const group of bucket.items) wrap.append(queueItem(group.representative, group));
    fragment.append(wrap);
  }
  els.queue.replaceChildren(fragment);
  els.queue.scrollTop = scrollTop;
  els.queue.dataset.signature = JSON.stringify({
    selected: state.selectedId,
    query: state.queueQuery,
    filter: state.queueFilter,
    tickets: state.tickets.map((ticket) => [
      ticket.id, ticket.state, ticket.sessionId, ticket.sessionTurn, ticket.claimedBy,
      ticket.preferredOperator, ticket.priority, ticket.noteCount, ticket.queueWaitMs,
      ticket.tags || [], ticket.preview || "",
    ]),
  });
}

