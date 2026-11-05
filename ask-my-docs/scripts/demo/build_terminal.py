"""Build the terminal replay page. Usage: python build_terminal.py captured.json terminal.html"""
import json, sys
src, dst = sys.argv[1], sys.argv[2]
data = json.load(open(src))
captions = [
 "Step 1: index your documents. Each one is split into passages and turned into searchable numbers that capture its meaning.",
 "Step 2: ask a question. It finds the best passages, then a local AI model answers from them and cites [1] [2].",
 "You can also see just the retrieval step: which passages were found, and how similar each one is. No AI model involved.",
 "If the documents do not contain the answer, it says so instead of making something up.",
 "A built-in check: for each test question, at what rank does the right passage appear? (#1 is best)",
 "And 60 automated tests keep the code honest.",
]
html = """<!doctype html><html><head><meta charset="utf-8"><title>terminal demo</title><style>
 html,body{margin:0;height:100%;background:#0b0f17;font-family:system-ui,Segoe UI,Roboto,sans-serif}
 .win{position:absolute;inset:26px 40px 26px 40px;background:#0d1320;border:1px solid #243049;border-radius:14px;overflow:hidden;
      box-shadow:0 20px 60px rgba(0,0,0,.5);display:flex;flex-direction:column}
 .bar{height:42px;background:#131a26;display:flex;align-items:center;gap:9px;padding:0 16px;border-bottom:1px solid #243049;flex:none}
 .dot{width:13px;height:13px;border-radius:50%}
 .title{color:#97a3b8;font-size:15px;margin-left:12px}
 #term{flex:1;min-height:0;padding:18px 26px;font:15.5px/21px "DejaVu Sans Mono","Liberation Mono",Menlo,Consolas,monospace;color:#e8edf6;
       white-space:pre-wrap;overflow:hidden;word-break:break-word}
 .p{color:#3ddc97;font-weight:700}.c{color:#e8edf6}.h{color:#00d4f0;font-weight:700}.ok{color:#3ddc97}.bad{color:#ff6b6b}
 .cite{color:#00d4f0}.dim{color:#8795ad}.warn{color:#ffd166}
 .caret{display:inline-block;width:10px;height:20px;background:#e8edf6;vertical-align:-3px;animation:b 1s steps(2) infinite}
 @keyframes b{50%{opacity:0}}
 .note{flex:none;padding:8px 26px;color:#7e8aa3;font-size:13px;border-top:1px solid #243049;background:#0f1522}
 .capbar{flex:none;min-height:96px;display:flex;align-items:center;padding:12px 28px;background:#0a1220;border-top:1px solid #243049;border-left:6px solid #00d4f0}
 #cap{color:#fff;font:600 23px/1.35 system-ui,Segoe UI,Roboto,sans-serif;opacity:0;transition:opacity .35s}
 #cap.on{opacity:1}
</style></head><body>
<div class="win"><div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="title">ask-my-docs: terminal</span></div>
<div id="term"></div>
<div class="capbar"><span id="cap"></span></div>
<div class="note">Output below is captured from a real run of the project. Typing and streaming speed are simulated for this video.</div></div>
<script>
const DATA = __DATA__, CAPS = __CAPS__;
const term = document.getElementById('term'), cap = document.getElementById('cap');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function color(line){
  let s = esc(line);
  s = s.replace(/^(Answer:|Sources:)/, '<span class="h">$1</span>');
  s = s.replace(/(\\[\\d+\\])/g, '<span class="cite">$1</span>');
  s = s.replace(/\\b(PASS|ok|passed)\\b/g, '<span class="ok">$1</span>');
  s = s.replace(/\\b(FAIL|miss)\\b/g, '<span class="bad">$1</span>');
  s = s.replace(/(known issue[^:]*:.*)$/, '<span class="warn">$1</span>');
  s = s.replace(/^(\\s+answer was:.*)$/, '<span class="dim">$1</span>');
  s = s.replace(/^(\\s{6}[^\\s<].*)$/, '<span class="dim">$1</span>');
  return s;
}
function add(html){ term.insertAdjacentHTML('beforeend', html); term.scrollTop = term.scrollHeight; }
async function typeCmd(cmd){
  add('<span class="p">$ </span><span id="cmd" class="c"></span><span class="caret" id="caret"></span>');
  const el = document.getElementById('cmd');
  for (const ch of cmd){ el.textContent += ch; await sleep(34); }
  await sleep(450);
  document.getElementById('caret').remove();
  add('\\n');
}
async function lines(arr, delay){ for (const l of arr){ add(color(l) + '\\n'); await sleep(delay); } }
async function run(){
  await sleep(700);
  for (let i = 0; i < DATA.length; i++){
    const e = DATA[i];
    term.innerHTML = '';
    cap.textContent = CAPS[i]; cap.classList.add('on');
    await typeCmd(e.cmd);
    const out = e.output.split('\\n');
    if (e.kind === 'ingest'){
      add(color(out[0]) + '\\n'); await sleep(1600); await lines(out.slice(1), 200);
    } else if (e.kind === 'ask'){
      const split = out.indexOf('Sources:');
      add('<span class="h">Answer:</span>\\n');
      const answer = out.slice(1, split).join('\\n').trim();
      for (const w of answer.split(/(\\s+)/)){ add(color(w).replace(/\\n/g,'\\n')); await sleep(w.trim() ? 70 : 0); }
      add('\\n\\n'); await sleep(500);
      await lines(out.slice(split), 130);
    } else {
      await lines(out, e.cmd.includes('evaluate') ? 55 : 120);
    }
    await sleep(e.cmd.includes('evaluate') ? 6500 : (e.cmd.includes('pytest') ? 3500 : 4800));
  }
  cap.classList.remove('on'); await sleep(700);
  window.__done = true;
}
run();
</script></body></html>"""
html = html.replace("__DATA__", json.dumps(data)).replace("__CAPS__", json.dumps(captions))
open(dst, "w").write(html)
print("built", len(html), "bytes")
