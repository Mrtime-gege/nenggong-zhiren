/**
 * Protocol registry. Adding a new request/response dialect means adding an
 * adapter module and registering it here; queue, storage and browser code stay
 * on the canonical shape.
 */

import { ANTHROPIC_PROTOCOL, OPENAI_PROTOCOL, ProtocolError } from "./common.mjs";
import { normalizeOpenAIRequest } from "./openai.mjs";
import {
  anthropicMessageJson,
  anthropicStopReason,
  anthropicToolBlocks,
  anthropicUsage,
  normalizeAnthropicRequest,
} from "./anthropic.mjs";

const adapters = {
  [OPENAI_PROTOCOL]: {
    name: OPENAI_PROTOCOL,
    normalize: normalizeOpenAIRequest,
  },
  [ANTHROPIC_PROTOCOL]: {
    name: ANTHROPIC_PROTOCOL,
    normalize: normalizeAnthropicRequest,
    messageJson: anthropicMessageJson,
    stopReason: anthropicStopReason,
    toolBlocks: anthropicToolBlocks,
    usage: anthropicUsage,
  },
};

export function getProtocol(name) {
  const adapter = adapters[name];
  if (!adapter) throw new Error(`Unsupported protocol: ${name}`);
  return adapter;
}

export function normalizeRequest(protocol, body, options = {}) {
  return getProtocol(protocol).normalize(body, options);
}

export { OPENAI_PROTOCOL, ANTHROPIC_PROTOCOL, ProtocolError };
