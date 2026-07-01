---
id: DASH-CHAT-DOC
title: Dashboard chat over the local knowledge base (no LLM)
owner: "@selvakumar"
priority: medium
---

<!-- id: DASH-CHAT-DOC -->
# Dashboard chat over the local knowledge base (no LLM)

The SpecShip dashboard already ships a chat page (`packages/web-ng` → `pages/chat`)
with a designed conversation UI — message list, slash-command palette, tool-call
cards, streaming affordances — but its `send()` handler is a mock: it delays,
then returns a hardcoded reply with fabricated tool output and random cost/token
numbers. There is no server chat endpoint.

This document specifies replacing that mock with a **deterministic answer engine**
that chats over the project's own data — the code knowledge graph, specs, domain
facts, and indexed sessions — **without any LLM**. Questions are classified by
rule, answered by querying the local SQLite knowledge base, composed into prose
from real results, and **faux-streamed** so the reply reads like a typing
assistant even though no model ran.

Two principles govern every requirement:

- **No LLM, ever.** The chat MUST NOT call any language model. Answers are
  produced entirely by deterministic classification + database queries +
  templated composition. This is a search-and-answer engine wearing a chat
  interface, not a chatbot.
- **Honesty (the SpecShip constraint).** Because no model runs, the reply MUST
  NOT present a model name, a cost, or a token count — those would imply an LLM
  that doesn't exist, and a fabricated metric is worse than no metric. The
  streaming animation is honest cosmetics; a fake cost figure is not.

Scope is the dashboard chat page and its server endpoint. The CLI and MCP tools
are unaffected.

<!-- id: REQ-DASH-CHAT-001 -->
## The chat MUST answer from the project's own knowledge base with no language-model call

Every answer MUST be derived deterministically from the local data — the code
knowledge graph (symbols, edges), specs and their links, domain facts, and
indexed session data — via database queries only. The chat endpoint MUST NOT
invoke any language model or external inference service, and MUST NOT fabricate
content not present in the data. Given identical data and question, it MUST
produce the same answer (deterministic).

implementations:
  - packages/server/src/routes/chat.ts:registerChatRoutes

## Acceptance
<!-- id: REQ-DASH-CHAT-001.A1 -->
- A question answerable from the graph/specs/domain returns an answer whose facts (names, paths, counts, states) all come from the queried data.
<!-- id: REQ-DASH-CHAT-001.A2 -->
- The chat request path makes no network call to any model/inference API and requires no model credentials to function.
<!-- id: REQ-DASH-CHAT-001.A3 -->
- The same question against an unchanged index returns the same answer content on repeat (deterministic; no randomness in the response body).
<!-- id: REQ-DASH-CHAT-001.A4 -->
- A question whose subject is absent from the index returns an honest "not found" style answer, never invented symbols, paths, or facts.

<!-- id: REQ-DASH-CHAT-002 -->
## Questions MUST be routed to the right query by a deterministic classifier, falling back to full-text search

A rule-based classifier (no model) maps each message to an intent and its query.
Slash commands route explicitly — `/ss-spec` → spec lookup, `/ss-explore` →
explore/trace, `/ss-check` → gate/drift/health. Free-form questions route by
keyword/pattern to the matching capability: callers ("who calls X"), callees
("what does X call"), impact ("what breaks if I change X"), explore ("how does X
work"), spec lookup, drift status, and domain lookup ("what is <term>"). When no
intent matches with confidence, the classifier MUST fall back to a full-text
search over the knowledge base and return the top matches — it never guesses an
intent and never returns nothing when data exists.

implementations:
  - packages/server/src/chat/classify.ts:classifyIntent

## Acceptance
<!-- id: REQ-DASH-CHAT-002.A1 -->
- A message beginning with `/ss-spec <ID>` routes to a spec lookup for that ID; `/ss-explore <symbols>` routes to explore; `/ss-check …` routes to gate/drift/health.
<!-- id: REQ-DASH-CHAT-002.A2 -->
- Free-form "who calls X" routes to callers, "what breaks if I change X" to impact, "how does X work" to explore, and "what is <term>" to domain lookup.
<!-- id: REQ-DASH-CHAT-002.A3 -->
- A message that matches no intent runs a full-text search and returns the top matching symbols / specs / domain facts.
<!-- id: REQ-DASH-CHAT-002.A4 -->
- Classification is a pure function of the message text (no model, no I/O in the classify step) and is unit-testable in isolation.

<!-- id: REQ-DASH-CHAT-003 -->
## Answers MUST be composed from real results and faux-streamed over SSE like a typing assistant

The endpoint composes the query results into a prose answer using templates that
fill slots from the real data, then streams it to the client over Server-Sent
Events as a sequence of events — a thinking indicator, the tool/query being run
with its input, the query's result summary, then the answer in incremental
chunks, then a done event. The full answer is computed deterministically before
streaming; the chunking is presentation pacing only (a small inter-chunk delay)
so the reply renders progressively like a model typing. A client disconnect MUST
end the stream cleanly without error.

implementations:
  - packages/server/src/routes/chat.ts:registerChatRoutes
  - packages/web-ng/src/app/pages/chat/chat.ts:Chat.send

## Acceptance
<!-- id: REQ-DASH-CHAT-003.A1 -->
- Sending a message opens an SSE stream that emits, in order: a thinking event, a tool/query event (name + input), a result-summary event, one or more answer-chunk events, and a terminal done event.
<!-- id: REQ-DASH-CHAT-003.A2 -->
- The answer text arrives in multiple chunks over time (progressive reveal), and the concatenation of the chunks equals the fully-composed answer.
<!-- id: REQ-DASH-CHAT-003.A3 -->
- The composed answer is fully determined before the first chunk is sent; chunk boundaries and pacing affect only presentation, not content.
<!-- id: REQ-DASH-CHAT-003.A4 -->
- If the client disconnects mid-stream, the server stops streaming and releases resources without throwing.

<!-- id: REQ-DASH-CHAT-004 -->
## The chat MUST NOT present a model name, cost, or token count, and its tool-call card MUST show the real query

Because no language model runs, the reply MUST NOT display a model badge, a cost
figure, or a token count. The tool-call card the UI renders MUST reflect the
**real** query performed — the capability name (e.g. `specship_explore`), the
actual input, and a truthful result summary derived from the query (e.g. node/
edge counts, match count) — never a fabricated summary. The mock's random
cost/token values and hardcoded reply MUST be removed.

implementations:
  - packages/web-ng/src/app/pages/chat/chat.ts:Chat.send

## Acceptance
<!-- id: REQ-DASH-CHAT-004.A1 -->
- A rendered assistant reply contains no model name, no cost figure, and no token count.
<!-- id: REQ-DASH-CHAT-004.A2 -->
- The tool-call card shows the capability actually invoked, the actual input, and a result summary computed from the query result (not a constant string).
<!-- id: REQ-DASH-CHAT-004.A3 -->
- The previous mock behaviour — fixed-delay canned reply, random cost/tokens, hardcoded tool output — is no longer present in the send path.
