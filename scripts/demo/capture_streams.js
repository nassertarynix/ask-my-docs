// Captures the real streamed answers (with their timing) for the questions used in the mobile demo.
// Usage: node capture_streams.js <streams.json>   (server running; run it while nothing else is using the CPU)
//   Env: DEMO_URL (default http://127.0.0.1:8000)
//
// record_web.js replays these during the recording. Recording at phone resolution leaves the
// CPU-only model too little CPU to answer at normal speed, so the answers are captured here first,
// at true speed, and replayed at their original timing.
const fs = require('fs');
const BASE = (process.env.DEMO_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const QUESTIONS = ['What does Al-Nasser do at Tarynix?', 'Does Al-Nasser know Rust?',
  'What is the meal allowance while travelling?'];   // the last one is answered from a PDF

async function capture(question) {
  const started = Date.now();
  const response = await fetch(BASE + '/api/ask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, top_k: 4, use_llm: true }),
  });
  if (!response.ok) throw new Error('ask failed: ' + response.status);
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
      if (line) events.push({ t: (Date.now() - started) / 1000, line });
    }
  }
  return events;
}

(async () => {
  await capture('warm up');                       // load the model first, so timings are typical
  const streams = {};
  for (const q of QUESTIONS) {
    streams[q] = await capture(q);
    const last = streams[q][streams[q].length - 1];
    console.log(`${q}  ->  ${streams[q].length} events in ${last.t.toFixed(1)} s`);
  }
  fs.writeFileSync(process.argv[2], JSON.stringify(streams));
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
