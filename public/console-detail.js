/** Ticket detail workspace construction. */

function buildDetail(ticket) {
  clearDetailTimers(detail);
  detail?.minimapObserver?.disconnect();
  els.detail.replaceChildren();
  const wrap = el("div", "detail-wrap");

  const head = el("div", "detail-head");
  const titleWrap = el("div");
  titleWrap.append(el("div", "eyebrow", "Human ticket"));
  const title = el("h2", "detail-title");
  const model = el("span", "", ticket.model);
  const id = el("span", "id", shortId(ticket.id));
  title.append(model, id);
  titleWrap.append(title);
  const badges = el("div", "badges");
  const commandPaletteBtn = el("button", "btn ghost command-palette-btn", "命令 ");
  commandPaletteBtn.type = "button";
  commandPaletteBtn.setAttribute("aria-haspopup", "dialog");
  commandPaletteBtn.setAttribute("aria-controls", "commandPalette");
  commandPaletteBtn.append(el("kbd", "", "⌘K"));
  commandPaletteBtn.addEventListener("click", openCommandPalette);
  const queueToggle = el("button", "btn ghost queue-toggle", document.body.classList.contains("queue-collapsed") ? "展开队列" : "收起队列");
  queueToggle.type = "button";
  queueToggle.addEventListener("click", toggleQueue);
  const inspectorToggle = el("button", "btn ghost inspector-toggle", "隐藏上下文");
  inspectorToggle.type = "button";
  const detailButtons = el("div", "detail-head-buttons");
  detailButtons.append(commandPaletteBtn, queueToggle, inspectorToggle);
  const headActions = el("div", "detail-head-actions");
  headActions.append(detailButtons, badges);
  head.append(titleWrap, headActions);

  const meta = el("div", "meta");
  const purposeHint = el("div", "purpose-hint hidden");
  const sessionBar = el("div", "session-bar hidden");

  const threadPane = el("section", "pane thread-pane");
  const threadHead = el("div", "pane-head thread-head");
  const threadTitle = el("span", "pane-title", "会话");
  const msgCount = el("span", "pane-note", "");
  threadHead.append(threadTitle, msgCount);
  const threadBody = el("div", "thread-body");
  threadBody.id = `thread-body-${ticket.id}`;
  const messages = el("div", "messages");
  const tools = el("div", "tools");
  tools.style.display = "none";
  const threadOutputHead = el("div", "thread-output-head");
  const outputTitle = el("span", "thread-output-title", "已发送");
  const charCount = el("span", "pane-note", "");
  threadOutputHead.append(outputTitle, charCount);
  const transcript = el("div", "transcript placeholder", "还没有发送任何内容。");
  const reasoningBox = el("details", "reasoning-box hidden");
  reasoningBox.open = true;
  const reasoningSummary = el("summary", "reasoning-summary", "已发送思考");
  const reasoningCount = el("span", "reasoning-count", "");
  reasoningSummary.append(reasoningCount);
  const reasoningText = el("pre", "reasoning-text", "");
  reasoningBox.append(reasoningSummary, reasoningText);
  const sentTools = el("div", "sent-toolcalls hidden");
  threadBody.append(messages, tools, threadOutputHead, reasoningBox, transcript, sentTools);
  const threadMinimap = el("div", "thread-minimap hidden");
  threadMinimap.dataset.minimapMode = state.minimapMode;
  threadMinimap.dataset.minimapSlider = state.minimapSlider;
  threadMinimap.dataset.minimapLayoutPreference = state.minimapLayout;
  threadMinimap.setAttribute("aria-label", "会话微缩总览与滚动位置");
  threadMinimap.setAttribute("aria-controls", threadBody.id);
  threadMinimap.setAttribute("role", "scrollbar");
  threadMinimap.setAttribute("aria-orientation", "vertical");
  threadMinimap.setAttribute("aria-valuemin", "0");
  threadMinimap.setAttribute("aria-valuemax", "100");
  threadMinimap.setAttribute("aria-valuenow", "0");
  threadMinimap.tabIndex = 0;
  const minimapClip = el("div", "minimap-clip");
  const minimapContent = el("div", "minimap-content");
  const minimapCanvas = el("canvas", "minimap-canvas hidden");
  minimapCanvas.setAttribute("aria-hidden", "true");
  const minimapViewport = el("div", "minimap-viewport");
  const minimapUnloaded = el("button", "minimap-unloaded hidden");
  minimapUnloaded.type = "button";
  const minimapLatest = el("button", "minimap-latest hidden", "回到最新");
  minimapLatest.type = "button";
  minimapLatest.title = "跳到最新消息";
  const minimapSlider = el("div", "minimap-slider");
  minimapSlider.append(minimapViewport);
  minimapClip.append(minimapContent, minimapCanvas);
  threadMinimap.append(minimapClip, minimapSlider, minimapUnloaded, minimapLatest);
  setupThreadMinimap(threadBody, threadMinimap, minimapClip, minimapContent, minimapViewport, minimapUnloaded, minimapLatest);
  threadPane.append(threadHead, threadBody, threadMinimap);

  const composer = el("div", "composer");
  const label = el("label", "composer-title", "回复草稿");
  const draft = el("textarea");
  draft.placeholder = "在这里写回复…";
  draft.spellcheck = false;
  const draftStatus = el("span", "draft-status", "");
  const draftCount = el("span", "composer-count", "0 字");

  const toolPanel = el("div", "toolcall-panel hidden");
  const toolTitle = el("div", "toolcall-title", "工具调用");
  const toolSub = el("div", "toolcall-sub", "");
  const toolFilter = el("input", "tool-filter");
  toolFilter.placeholder = "筛选工具（支持名称搜索）";
  toolFilter.autocomplete = "off";
  toolFilter.spellcheck = false;
  const toolSelect = el("select", "tool-select");
  const toolDesc = el("div", "tool-desc");
  const toolArgs = el("textarea", "tool-args");
  toolArgs.placeholder = 'JSON 参数，例如 {"city":"上海"}';
  toolArgs.spellcheck = false;
  const toolError = el("div", "tool-error hidden");
  const toolButtons = el("div", "tool-actions");
  const toolAdd = el("button", "btn primary", "添加工具调用");
  toolAdd.type = "button";
  const toolCancelEdit = el("button", "btn ghost hidden", "取消修改");
  toolCancelEdit.type = "button";
  const toolTemplate = el("button", "btn ghost", "填充参数模板");
  toolTemplate.type = "button";
  const toolFormat = el("button", "btn ghost", "格式化 JSON");
  toolFormat.type = "button";
  const toolSend = el("button", "btn primary", "发送工具调用并完成");
  toolSend.type = "button";
  toolSend.title = "将当前工具调用作为响应发回调用方；不会在本机执行工具。";
  toolButtons.append(toolAdd, toolCancelEdit, toolTemplate, toolFormat, toolSend);
  const toolHint = el("div", "tool-hint", "工具调用只会返回给调用方，不会在本机执行。Ctrl+Enter 可添加或保存。");
  const toolPending = el("div", "toolcall-pending");
  toolPanel.append(toolTitle, toolSub, toolFilter, toolSelect, toolDesc, toolArgs, toolError, toolButtons, toolHint, toolPending);

  const note = el("div", "composer-note hidden");

  const inspector = el("aside", "inspector context-pane");
  const inspectorHead = el("div", "inspector-head");
  inspectorHead.append(el("span", "", "上下文"));
  inspectorHead.append(el("span", "inspector-hint", "资料 / 当前发送 / 工具 / AI / 更多"));
  const inspectorTabs = el("div", "inspector-tabs");
  const tabButtons = {};
  let aiTabDot = null;
  let aiTabCount = null;
  for (const [key, tabLabel] of [["info", "资料"], ["sent", "当前发送"], ["tools", "工具"], ["ai", "AI"], ["more", "更多"]]) {
    const button = el("button", "inspector-tab");
    button.type = "button";
    button.dataset.tab = key;
    button.append(el("span", "inspector-tab-label", tabLabel));
    if (key === "ai") {
      aiTabDot = el("span", "ai-tab-dot hidden");
      aiTabCount = el("span", "ai-tab-count hidden");
      aiTabDot.setAttribute("aria-hidden", "true");
      aiTabCount.setAttribute("aria-hidden", "true");
      button.append(aiTabDot, aiTabCount);
    }
    button.addEventListener("click", () => activateInspectorTab(current, key));
    tabButtons[key] = button;
    inspectorTabs.append(button);
  }
  const inspectorBody = el("div", "inspector-body context-body");
  const infoSection = el("div", "inspector-tab-panel context-info");
  const infoOverview = contextSection("票据概览", "当前请求");
  infoOverview.body.append(meta, purposeHint);
  const infoDetails = contextSection("请求详情", "协议 / 限制 / 客户端");
  const infoExtra = el("div", "info-extra");
  infoDetails.body.append(infoExtra);
  const infoSession = contextSection("相关会话", "同会话轮次");
  infoSession.body.append(sessionBar);
  const requestSection = contextSection("请求检查", "原始 / 归一化");
  const requestDetails = el("details", "request-inspector");
  requestDetails.open = false;
  requestDetails.addEventListener("toggle", () => { if (current) current.requestOpen = requestDetails.open; });
  const requestSummary = el("summary", "request-inspector-summary", "查看请求格式");
  const requestToolbar = el("div", "request-inspector-toolbar");
  const requestRawButton = el("button", "request-inspector-toggle active", "原始请求");
  const requestNormalizedButton = el("button", "request-inspector-toggle", "归一化请求");
  const requestCopyButton = el("button", "btn ghost request-inspector-copy", "复制");
  requestRawButton.type = "button";
  requestNormalizedButton.type = "button";
  requestCopyButton.type = "button";
  requestToolbar.append(requestRawButton, requestNormalizedButton, requestCopyButton);
  const requestHint = el("div", "request-inspector-hint", "请求快照按请求体上限保留；不会进入调用方响应。");
  const requestPre = el("pre", "request-inspector-pre", "展开后查看请求。");
  requestDetails.append(requestSummary, requestToolbar, requestHint, requestPre);
  requestSection.body.append(requestDetails);
  infoSection.append(infoOverview.section, infoDetails.section, requestSection.section, infoSession.section);
  const sentSection = el("div", "inspector-tab-panel context-sent");
  const sentHead = el("div", "sent-panel-head");
  sentHead.append(el("span", "sent-panel-title", "当前发送"));
  sentHead.append(el("span", "sent-panel-hint", "已发送给调用方"));
  const sentReasoningBlock = el("section", "sent-block sent-reasoning-block");
  const sentReasoningHead = el("div", "sent-block-head");
  const sentReasoningTitle = el("span", "sent-block-title", "思考");
  const sentReasoningCount = el("span", "sent-block-count", "0 字");
  const sentReasoningCopy = el("button", "sent-copy", "复制");
  sentReasoningCopy.type = "button";
  sentReasoningHead.append(sentReasoningTitle, sentReasoningCount, sentReasoningCopy);
  const sentReasoning = el("pre", "sent-content sent-reasoning-content");
  const sentReasoningEmpty = el("div", "sent-empty sent-reasoning-empty", "还没有发送思考");
  sentReasoningBlock.append(sentReasoningHead, sentReasoning, sentReasoningEmpty);
  const sentTextBlock = el("section", "sent-block sent-text-block");
  const sentTextHead = el("div", "sent-block-head");
  const sentTextTitle = el("span", "sent-block-title", "正文");
  const sentTextCount = el("span", "sent-block-count", "0 字");
  const sentTextCopy = el("button", "sent-copy", "复制");
  sentTextCopy.type = "button";
  sentTextHead.append(sentTextTitle, sentTextCount, sentTextCopy);
  const sentText = el("pre", "sent-content sent-text-content");
  const sentTextEmpty = el("div", "sent-empty sent-text-empty", "还没有发送正文");
  sentTextBlock.append(sentTextHead, sentText, sentTextEmpty);
  sentSection.append(sentHead, sentReasoningBlock, sentTextBlock);
  sentReasoningCopy.addEventListener("click", () => copyMessageText(sentReasoning.textContent));
  sentTextCopy.addEventListener("click", () => copyMessageText(sentText.textContent));
  const toolsSection = el("div", "inspector-tab-panel");
  const aiSection = el("div", "inspector-tab-panel");
  const notesSection = el("div", "inspector-tab-panel");
  const toolEmpty = el("div", "inspector-empty", "");
  toolsSection.append(toolPanel, toolEmpty);
  const routingPanel = el("section", "ticket-extra routing-panel");
  const notesPanel = el("section", "ticket-extra notes-panel");
  const moreActions = el("div", "more-action-grid");
  const moreRefresh = el("button", "btn ghost", "刷新票据");
  moreRefresh.type = "button";
  moreRefresh.addEventListener("click", async () => {
    try { await loadTicketDetail(ticket.id); toast("票据已刷新"); }
    catch (error) { toast(error.message || "刷新失败"); }
  });
  const moreCopyId = el("button", "btn ghost", "复制 ID");
  moreCopyId.type = "button";
  moreCopyId.addEventListener("click", () => copyMessageText(ticket.id));
  const moreCopyReply = el("button", "btn ghost", "复制回复");
  moreCopyReply.type = "button";
  moreCopyReply.addEventListener("click", () => {
    const current = currentTicket();
    const value = current?.text || current?.refusal || "";
    if (!value) { toast("当前没有已发送正文"); return; }
    copyMessageText(value);
  });
  const moreHistory = el("button", "btn ghost", "查看历史");
  moreHistory.type = "button";
  moreHistory.addEventListener("click", () => openSubpage(`/console/records?tab=history&ticket=${encodeURIComponent(ticket.id)}`, "历史"));
  moreActions.append(moreRefresh, moreCopyId, moreCopyReply);
  if (state.role === "admin") moreActions.append(moreHistory);
  const quickTemplate = el("button", "btn ghost", "快捷回复");
  quickTemplate.type = "button";
  quickTemplate.addEventListener("click", openTemplateModal);
  const quickTransfer = el("button", "btn ghost", "转交");
  quickTransfer.type = "button";
  quickTransfer.addEventListener("click", openTransfer);
  moreActions.append(quickTemplate, quickTransfer);
  let quickTakeover = null;
  if (state.role === "admin") {
    quickTakeover = el("button", "btn ghost editor-takeover", "管理员接管");
    quickTakeover.type = "button";
    quickTakeover.addEventListener("click", takeoverTicket);
    moreActions.append(quickTakeover);
  }
  const moreActionsSection = contextSection("操作", "刷新 / 复制 / 模板 / 转交");
  moreActionsSection.body.append(moreActions);
  routingPanel.classList.add("context-section");
  notesPanel.classList.add("context-section");
  notesSection.append(moreActionsSection.section, routingPanel, notesPanel);
  inspectorBody.append(infoSection, sentSection, toolsSection, aiSection, notesSection);
  inspector.append(inspectorHead, inspectorTabs, inspectorBody);

  const aiTools = el("div", "ai-tools hidden");
  const aiTrigger = el("button", "btn ghost ai-menu-trigger", "AI 生成");
  aiTrigger.type = "button";
  aiTrigger.title = "生成结果会显示在 AI 子页；不会自动填入草稿或工具";
  aiTrigger.addEventListener("click", () => runAiTask("reply", detail, state.aiPrompts.get(ticket.id) || ""));
  const aiPromptTrigger = el("button", "btn ghost ai-prompt-trigger", "AI 引导");
  aiPromptTrigger.type = "button";
  aiPromptTrigger.title = "给本次/再次生成附加一段方向提示";
  aiPromptTrigger.setAttribute("aria-expanded", "false");
  const aiPromptPopover = el("div", "ai-prompt-popover hidden");
  const aiPromptLabel = el("label", "ai-prompt-label", "生成引导（可选）");
  const aiPromptInput = el("textarea", "ai-prompt-input");
  aiPromptInput.maxLength = 500;
  aiPromptInput.placeholder = "例如：更简短、先确认订单号、用英文回复…";
  aiPromptInput.value = state.aiPrompts.get(ticket.id) || "";
  aiPromptInput.addEventListener("input", () => {
    const value = aiPromptInput.value.trim();
    if (value) state.aiPrompts.set(ticket.id, value);
    else state.aiPrompts.delete(ticket.id);
    updateAiPromptTrigger(detail);
  });
  const aiPromptActions = el("div", "ai-prompt-actions");
  const aiPromptGenerate = el("button", "btn primary", "带引导生成");
  aiPromptGenerate.type = "button";
  const aiPromptClear = el("button", "btn ghost", "清空");
  aiPromptClear.type = "button";
  aiPromptClear.addEventListener("click", () => {
    aiPromptInput.value = "";
    state.aiPrompts.delete(ticket.id);
    updateAiPromptTrigger(detail);
    aiPromptInput.focus();
  });
  aiPromptGenerate.addEventListener("click", () => {
    const instruction = aiPromptInput.value.trim();
    aiPromptPopover.classList.add("hidden");
    aiPromptTrigger.setAttribute("aria-expanded", "false");
    runAiTask("reply", detail, instruction);
  });
  aiPromptActions.append(aiPromptGenerate, aiPromptClear);
  aiPromptInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      aiPromptGenerate.click();
    }
  });
  aiPromptPopover.append(aiPromptLabel, aiPromptInput, aiPromptActions);
  aiPromptTrigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const hidden = aiPromptPopover.classList.toggle("hidden");
    aiPromptTrigger.setAttribute("aria-expanded", hidden ? "false" : "true");
    if (!hidden) aiPromptInput.focus();
  });
  aiTools.append(aiTrigger, aiPromptTrigger, aiPromptPopover);
  const quickBar = el("div", "quick-bar hidden");
  const aiButtons = { reply: aiTrigger };
  const aiPanel = el("section", "ai-panel hidden");
  const aiPanelHead = el("div", "ai-panel-head");
  const aiPanelTitle = el("span", "", "AI 建议");
  const aiPanelHint = el("span", "ai-panel-hint", "不会自动发送");
  aiPanelHead.append(aiPanelTitle, aiPanelHint);
  const aiLiveStatus = el("div", "ai-live-status hidden");
  aiLiveStatus.setAttribute("role", "status");
  aiLiveStatus.setAttribute("aria-live", "polite");
  const aiPanelBody = el("pre", "ai-panel-body", "");
  const aiPanelActions = el("div", "ai-panel-actions");
  const aiInsert = el("button", "btn primary hidden", "插入草稿");
  aiInsert.type = "button";
  const aiApply = el("button", "btn primary hidden", "应用建议");
  aiApply.type = "button";
  const aiCopy = el("button", "btn ghost", "复制");
  aiCopy.type = "button";
  const aiExpand = el("button", "btn ghost", "展开全文");
  aiExpand.type = "button";
  const aiClose = el("button", "btn ghost", "关闭");
  aiClose.type = "button";
  aiPanelActions.append(aiExpand, aiCopy, aiClose);
  aiPanel.append(aiPanelHead, aiLiveStatus, aiPanelBody, aiPanelActions);
  const aiCardToolbar = el("div", "ai-card-toolbar hidden");
  const aiCardSelection = el("span", "ai-card-selection", "未选择结果");
  const aiReplace = el("button", "btn primary ai-card-replace", "填入");
  aiReplace.type = "button";
  aiReplace.title = "用选中的 AI 结果替换当前草稿和全部工具调用";
  const aiAppend = el("button", "btn ghost ai-card-append", "追加");
  aiAppend.type = "button";
  aiAppend.title = "把选中的 AI 结果追加到当前草稿和工具调用之后";
  aiCardToolbar.append(aiTools, aiCardSelection, aiReplace, aiAppend);
  aiReplace.addEventListener("click", () => applySelectedAiCard("replace"));
  aiAppend.addEventListener("click", () => applySelectedAiCard("append"));
  const aiCardList = el("div", "ai-card-list hidden");
  const aiStatus = el("div", "ai-compact-status hidden");
  const aiEmpty = el("div", "ai-empty", "还没有 AI 结果。使用上方「AI 生成」创建结果卡片。");
  aiSection.append(aiCardToolbar, aiCardList, aiStatus, aiPanel, aiEmpty);

  const clearButton = el("button", "btn ghost editor-clear", "清空");
  clearButton.type = "button";
  clearButton.title = "清空当前草稿和待发送工具调用";
  clearButton.addEventListener("click", clearEditorContent);
  const composerHead = el("div", "composer-head");
  composerHead.append(label, draftStatus, draftCount, quickBar, clearButton);
  const composerMain = el("div", "composer-main");
  composerMain.append(composerHead, draft, note);
  composer.append(composerMain);
  const editorSplitter = el("div", "editor-height-splitter");
  editorSplitter.tabIndex = 0;
  editorSplitter.setAttribute("role", "separator");
  editorSplitter.setAttribute("aria-orientation", "horizontal");
  editorSplitter.title = "拖动调整回复编辑区高度，双击恢复默认";
  const editorHeight = Math.max(180, Math.min(520, Number(localStorage.getItem("ngzr.editorHeight")) || 220));
  wrap.style.setProperty("--editor-height", `${editorHeight}px`);
  setupEditorSplitter(editorSplitter, wrap, composer);

  const contextSplitter = el("div", "context-width-splitter");
  contextSplitter.tabIndex = 0;
  contextSplitter.setAttribute("role", "separator");
  contextSplitter.setAttribute("aria-orientation", "vertical");
  contextSplitter.title = "拖动调整会话与上下文宽度，双击恢复默认";
  const workspace = el("div", "workspace conversation-workspace");
  workspace.append(threadPane, contextSplitter, inspector);
  setupContextSplitter(contextSplitter, workspace, inspector);
  wrap.append(head, workspace, editorSplitter, composer);
  els.detail.append(wrap);

  const current = { id: ticket.id, els: {} };
  current.inspectorTab = loadInspectorTab();
  let savedCollapsed = null;
  try { savedCollapsed = localStorage.getItem(INSPECTOR_COLLAPSED_KEY); } catch { /* optional */ }
  current.inspectorCollapsed = savedCollapsed === null
    ? window.matchMedia("(max-width: 1080px)").matches
    : loadInspectorCollapsed();
  current.els = {
    model,
    id,
    badges,
    meta,
    purposeHint,
    sessionBar,
    messages,
    tools,
    msgCount,
    transcript,
    charCount,
    reasoningBox,
    reasoningCount,
    reasoningText,
    sentTools,
    draft,
    draftStatus,
    draftCount,
    composer,
    composerMain,
    aiTools,
    aiTrigger,
    quickBar,
    aiButtons,
    aiPromptTrigger,
    aiPromptPopover,
    aiPromptInput,
    aiPromptGenerate,
    aiPromptClear,
    aiPanel,
    aiEmpty,
    aiCardToolbar,
    aiCardSelection,
    aiReplace,
    aiAppend,
    aiCardList,
    aiStatus,
    aiPanelTitle,
    aiPanelHint,
    aiLiveStatus,
    aiPanelBody,
    aiInsert,
    aiApply,
    aiExpand,
    aiCopy,
    aiClose,
    workspace,
    threadPane,
    threadBody,
    threadOutputHead,
    threadMinimap,
    minimapClip,
    minimapContent,
    minimapCanvas,
    minimapSlider,
    minimapViewport,
    minimapUnloaded,
    minimapLatest,
    contextSplitter,
    inspector,
    inspectorHead,
    inspectorTabs,
    inspectorBody,
    infoSection,
    infoExtra,
    requestDetails,
    requestPre,
    requestHint,
    requestRawButton,
    requestNormalizedButton,
    requestCopyButton,
    infoSession: infoSession.section,
    sentSection,
    sentReasoning,
    sentReasoningCount,
    sentReasoningEmpty,
    sentReasoningCopy,
    sentText,
    sentTextCount,
    sentTextEmpty,
    sentTextCopy,
    toolsSection,
    aiSection,
    notesSection,
    moreActions,
    moreRefresh,
    moreCopyReply,
    clearButton,
    quickTakeover,
    tabButtons,
    aiTabDot,
    aiTabCount,
    toolPanel,
    toolEmpty,
    toolTitle,
    toolSub,
    toolFilter,
    toolSelect,
    toolDesc,
    toolArgs,
    toolError,
    toolAdd,
    toolCancelEdit,
    toolTemplate,
    toolFormat,
    toolSend,
    toolPending,
    routingPanel,
    notesPanel,
    note,
    inspectorToggle,
    claim: els.cmdClaim,
    push: els.cmdPush,
    finish: els.cmdFinish,
    release: els.cmdRelease,
    refuse: els.cmdRefuse,
    cancel: els.cmdCancel,
  };

  const restoredDraft = state.drafts.get(ticket.id) || "";
  draft.value = restoredDraft;
  if (restoredDraft) draftStatus.textContent = "已恢复未发送草稿";
  syncDraftMeta(current);
  draft.addEventListener("input", () => {
    if (!detail) return;
    setDraft(detail.id, draft.value);
    draftStatus.textContent = draft.value.trim() ? "草稿已自动保存" : "";
    syncDraftMeta(detail);
    syncClearButton(currentTicket(), detail);
  });
  toolFilter.addEventListener("input", () => {
    const currentTicket = state.tickets.find((item) => item.id === state.selectedId);
    if (currentTicket) renderToolPanel(currentTicket, detail);
  });
  toolSelect.addEventListener("change", () => {
    const currentTicket = state.tickets.find((item) => item.id === state.selectedId);
    if (currentTicket) {
      fillToolTemplate();
      renderToolPanel(currentTicket, detail);
    }
  });
  toolArgs.addEventListener("input", () => {
    detail.toolArgsDirty = true;
    setToolError(detail, "");
    syncClearButton(currentTicket(), detail);
  });
  toolArgs.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      addToolCallFromUI();
    }
  });
  toolAdd.addEventListener("click", addToolCallFromUI);
  toolCancelEdit.addEventListener("click", cancelToolEdit);
  toolTemplate.addEventListener("click", fillToolTemplate);
  toolFormat.addEventListener("click", formatToolArgs);
  toolArgs.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      addToolCallFromUI();
    }
  });
  toolSend.addEventListener("click", sendToolCalls);
  current.toolEditing = null;
  current.messagesLimit = 30;

  inspectorToggle.addEventListener("click", () => {
    current.inspectorCollapsed = !current.inspectorCollapsed;
    try { localStorage.setItem(INSPECTOR_COLLAPSED_KEY, current.inspectorCollapsed ? "1" : "0"); } catch { /* optional */ }
    applyInspectorState(current);
  });
  current.els.requestRawButton.addEventListener("click", () => {
    current.requestView = "raw";
    renderRequestInspector(currentTicket(), current);
  });
  current.els.requestNormalizedButton.addEventListener("click", () => {
    current.requestView = "normalized";
    renderRequestInspector(currentTicket(), current);
  });
  current.els.requestCopyButton.addEventListener("click", () => {
    copyMessageText(current.els.requestPre.textContent);
  });
  detail = current;
  threadBody.addEventListener("scroll", () => scheduleThreadMinimapUpdate(current), { passive: true });
  threadBody.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" || current.minimapHoverReady) return;
    current.minimapHoverReady = true;
    threadMinimap.classList.add("hover-ready");
  }, { passive: true });
  threadBody.addEventListener("wheel", () => {
    if (!current.minimapHoverReady) {
      current.minimapHoverReady = true;
      threadMinimap.classList.add("hover-ready");
    }
    revealThreadMinimap(current);
  }, { passive: true });
  threadBody.addEventListener("touchstart", () => revealThreadMinimap(current), { passive: true });
  if (typeof ResizeObserver !== "undefined") {
    current.minimapObserver = new ResizeObserver(() => scheduleThreadMinimapUpdate(current));
    current.minimapObserver.observe(threadBody);
  }
  requestAnimationFrame(() => updateThreadMinimap(current));
  applyInspectorState(current);
  activateInspectorTab(current, current.inspectorTab);
  return current;
}

