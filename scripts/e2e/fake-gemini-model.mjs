/**
 * A scripted stand-in for the Gemini API (REQ-AGENTSWITCH-005/010 e2e): it
 * speaks generateContent / streamGenerateContent / countTokens on the wire, so
 * the REAL Gemini CLI runs its full agent loop — tool declaration, function
 * call, MCP execution, function response — against SpecShip, with only the
 * model's choices scripted. Turn 1: call the declared SpecShip explore tool.
 * Turn 2 (a functionResponse came back): answer with text quoting it.
 *
 *   node scripts/e2e/fake-gemini-model.mjs <port> <log.jsonl>
 * Point Gemini CLI at it with GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:<port>.
 */
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] || 0);
const logFile = process.argv[3];
const log = (o) => { if (logFile) fs.appendFileSync(logFile, JSON.stringify(o) + '\n'); };

function reply(body) {
  const contents = Array.isArray(body.contents) ? body.contents : [];
  const declared = (body.tools || []).flatMap((t) => (t.functionDeclarations || []).map((f) => f.name));
  const responses = contents.flatMap((c) => (c.parts || []).filter((p) => p.functionResponse).map((p) => p.functionResponse));
  if (responses.length > 0) {
    const out = JSON.stringify(responses[responses.length - 1].response ?? {});
    const quoted = /function renderScene[^"\\]*/.exec(out)?.[0] ?? out.slice(0, 160);
    return { parts: [{ text: `ANSWER: SpecShip returned the source — ${quoted}` }], declared, phase: 'answer' };
  }
  const explore = declared.find((n) => /specship_explore$/.test(n));
  if (!explore) return { parts: [{ text: 'NO_SPECSHIP_TOOL_DECLARED' }], declared, phase: 'no-tool' };
  return { parts: [{ functionCall: { name: explore, args: { query: 'renderScene layoutRows' } } }], declared, phase: 'call', tool: explore };
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* not JSON */ }
    const url = req.url || '';
    if (url.includes(':countTokens')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ totalTokens: 10 }));
    }
    const usage = { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 };
    if (url.includes(':streamGenerateContent')) {
      const r = reply(body);
      log({ path: url.split('?')[0], phase: r.phase, tool: r.tool, declaredSpecship: r.declared.filter((n) => /specship/.test(n)) });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: r.parts }, finishReason: 'STOP', index: 0 }], usageMetadata: usage })}\n\n`);
      return res.end();
    }
    if (url.includes(':generateContent')) {
      // Side calls (routing classifier, loop checks): a neutral JSON reply.
      log({ path: url.split('?')[0], phase: 'side-call' });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '{"reasoning":"simple","model_choice":"flash"}' }] }, finishReason: 'STOP', index: 0 }], usageMetadata: usage }));
    }
    log({ path: url, phase: 'unhandled' });
    res.writeHead(404); res.end('{}');
  });
});
server.listen(port, '127.0.0.1', () => console.log(`fake-gemini-model listening on ${server.address().port}`));
