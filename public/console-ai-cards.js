/** AI result card state shared by the operator console. */

function aiInputSummary(ticket) {
  const messages = Array.isArray(ticket?.messages) ? ticket.messages : [];
  let chars = 0;
  for (const message of messages) {
    if (typeof message?.content === "string") chars += message.content.length;
  }
  return `${messages.length} 条消息 · ${chars} 字符`;
}


function syncServerAiCards(ticket) {
  if (!ticket || !Array.isArray(ticket.aiCards)) return;
  const serverCards = ticket.aiCards.slice(-MAX_CLIENT_AI_CARDS);
  if (!serverCards.length) return;
  const cards = aiCardsFor(ticket.id);
  for (const raw of serverCards) {
    if (!raw?.id) continue;
    const normalized = {
      id: String(raw.id),
      reasoning: typeof raw.reasoning === "string" ? raw.reasoning : "",
      content: typeof raw.content === "string" ? raw.content : "",
      toolCalls: normalizeAiToolCalls(raw.toolCalls),
      source: raw.source || "manual",
      model: raw.model || "",
      finishReason: raw.finishReason || "",
      usage: raw.usage || null,
      createdAt: Number(raw.createdAt) || Date.now(),
      startedAt: Number(raw.startedAt) || 0,
      finishedAt: Number(raw.finishedAt) || 0,
      elapsedMs: Number(raw.elapsedMs) || 0,
      inputSummary: raw.inputSummary || "",
      instruction: raw.instruction || "",
    };
    const existing = cards.find((card) => card.id === normalized.id);
    if (existing) Object.assign(existing, normalized);
    else cards.push({ ...normalized, detailsOpen: false });
  }
  if (cards.length > MAX_CLIENT_AI_CARDS) cards.splice(0, cards.length - MAX_CLIENT_AI_CARDS);
  const selected = selectedAiCard(ticket.id);
  if (!selected && cards.length) {
    state.aiSelectedCards.set(ticket.id, cards.at(-1).id);
  }
  if (detail?.id === ticket.id) detail.aiCardsSignature = "";
}

function aiCardsFor(ticketId) {
  if (!state.aiCards) state.aiCards = new Map();
  let cards = state.aiCards.get(ticketId);
  if (!cards) {
    cards = [];
    state.aiCards.set(ticketId, cards);
  }
  return cards;
}

function selectedAiCard(ticketId) {
  const cards = aiCardsFor(ticketId);
  const id = state.aiSelectedCards?.get(ticketId);
  return cards.find((card) => card.id === id) || null;
}

function cardSourceLabel(source) {
  if (source === "auto_receive") return "自动生成";
  if (source === "auto_claim") return "认领生成";
  if (source === "manual") return "手动生成";
  return source ? String(source) : "AI 结果";
}

function addAiCard(ticket, d, {
  id = "",
  reasoning = "",
  content = "",
  toolCalls = [],
  source = "manual",
  finishReason = "",
  usage = null,
  createdAt = Date.now(),
  startedAt = 0,
  finishedAt = 0,
  elapsedMs = 0,
  inputSummary = "",
  instruction = "",
} = {}) {
  const cards = aiCardsFor(ticket.id);
  const cardId = id || `ai_${Date.now()}_${++aiCardSequence}`;
  const existing = id ? cards.find((item) => item.id === id) : null;
  if (existing) {
    Object.assign(existing, {
      reasoning, content, toolCalls: normalizeAiToolCalls(toolCalls), source, finishReason,
      usage, createdAt, startedAt, finishedAt, elapsedMs, inputSummary, instruction,
    });
    state.aiSelectedCards.set(ticket.id, existing.id);
    if (d) d.aiCardsSignature = "";
    renderAiCards(ticket, d, true);
    return existing;
  }
  const card = {
    id: cardId,
    reasoning: typeof reasoning === "string" ? reasoning : "",
    content: typeof content === "string" ? content : "",
    toolCalls: normalizeAiToolCalls(toolCalls),
    source,
    finishReason,
    usage,
    createdAt,
    startedAt,
    finishedAt,
    elapsedMs,
    inputSummary,
    instruction,
    detailsOpen: false,
  };
  cards.push(card);
  state.aiSelectedCards.set(ticket.id, card.id);
  if (d) d.aiCardsSignature = "";
  renderAiCards(ticket, d, true);
  return card;
}

