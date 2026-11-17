// 情绪看板网页：左边档案，右边实时情绪权重
import http from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.EMOTION_HOME || join(HERE, '..');
const CFG = existsSync(join(HOME, 'config.json')) ? JSON.parse(readFileSync(join(HOME, 'config.json'), 'utf8')) : {};
const PORT = Number(CFG.dashboardPort ?? 8095);
const AVATAR = CFG.avatarPath ? String(CFG.avatarPath) : '';
const NAME = CFG.name || '柔柔鲸';
const TAGLINE = CFG.tagline || '一只住在鱼缸里的 AI';
const BIOS = CFG.bios || ['慢热，话不多，损人挺准。'];

let cache = { at: 0, data: null };
function state() {
  return new Promise((resolve) => {
    if (Date.now() - cache.at < 20000 && cache.data) return resolve(cache.data);
    execFile(process.execPath, [join(HERE, 'emotions.mjs'), 'tick', ''], { timeout: 15000 }, (err, stdout) => {
      if (err) return resolve(cache.data || { rows: [] });
      try { const d = JSON.parse(stdout); cache = { at: Date.now(), data: d }; resolve(d); } catch { resolve(cache.data || { rows: [] }); }
    });
  });
}

const HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${NAME} · 情绪看板</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0b1220;color:#e8eef7;font-family:"Microsoft YaHei",system-ui,sans-serif}
.wrap{display:flex;min-height:100vh;flex-wrap:wrap}
.profile{flex:0 0 320px;padding:28px 22px;background:linear-gradient(180deg,#101a2e,#0b1220);border-right:1px solid #1d2a42}
.avatar{width:160px;height:160px;border-radius:50%;object-fit:cover;border:3px solid #2b3d5e;display:block;margin:0 auto;background:#1b2942}
.name{text-align:center;font-size:26px;font-weight:700;margin-top:14px;color:#ffd57a}
.tag{text-align:center;color:#8ea3c0;font-size:13px;margin-top:6px}
.card{margin-top:18px;background:#111c30;border:1px solid #1f2c45;border-radius:14px;padding:14px}
.card h3{margin:0 0 8px;font-size:14px;color:#9fb4d0}
.card p{margin:6px 0;font-size:14px;line-height:1.7;color:#cfdcea}
.board{flex:1 1 420px;padding:28px 26px;min-width:340px}
.title{font-size:22px;font-weight:700;color:#ffd57a}
.sub{color:#8ea3c0;font-size:13px;margin:6px 0 22px}
.row{margin:14px 0}.lbl{display:flex;justify-content:space-between;font-size:15px;margin-bottom:6px}
.bar{height:16px;border-radius:9px;background:#16233a;overflow:hidden}
.fill{height:100%;border-radius:9px;background:linear-gradient(90deg,#4b8ef7,#7fc4ff);transition:width .6s}
.fill.top{background:linear-gradient(90deg,#ffb347,#ffd57a)}
.now{margin-top:26px;background:#111c30;border:1px solid #1f2c45;border-radius:14px;padding:16px}
.now b{color:#ffd57a;font-size:18px}.act{color:#cfdcea;font-size:14px;margin-top:8px;line-height:1.8}
.foot{color:#5f7492;font-size:12px;margin-top:18px}
</style></head><body><div class="wrap">
<div class="profile">
<img class="avatar" src="/avatar.png" alt="${NAME}">
<div class="name">${NAME}</div><div class="tag">${TAGLINE}</div>
${BIOS.map((b) => `<div class="card"><h3>关于</h3><p>${b}</p></div>`).join('')}
<div class="card"><h3>情绪引擎</h3><p>现代霍普菲尔德网络：13 种情绪当吸引子，随时间衰减，一句话推动一次。</p></div>
</div>
<div class="board">
<div class="title">现在的心情</div><div class="sub" id="sub">正在读取…</div>
<div id="rows"></div>
<div class="now"><div>此刻：<b id="topName">—</b> <span id="topPct"></span></div><div class="act" id="act"></div></div>
<div class="foot">每 20 秒刷新；心跳每分钟一次。</div>
</div></div>
<script>
async function refresh(){try{
 const r=await fetch('/api/state',{cache:'no-store'});const d=await r.json();const rows=d.rows||[];
 document.getElementById('sub').textContent='更新于 '+new Date().toLocaleTimeString('zh-CN');
 const box=document.getElementById('rows');box.innerHTML='';
 rows.forEach((x,i)=>{box.insertAdjacentHTML('beforeend',
  '<div class="row"><div class="lbl"><span>'+x.name+'</span><span>'+(x.w*100).toFixed(1)+'%</span></div><div class="bar"><div class="fill'+(i===0?' top':'')+'" style="width:'+Math.max(2,x.w*100)+'%"></div></div></div>')});
 const t=rows[0]||{name:'—',w:0,act:{}};document.getElementById('topName').textContent=t.name;
 document.getElementById('topPct').textContent=(t.w*100).toFixed(0)+'%';
 const a=t.act||{};document.getElementById('act').textContent='会怎么回：'+(a['回话']||'-')+'　｜　主动找你：'+(a['主动找你']?'会':'不会')+'　｜　怼人：'+(a['怼人']?'会':'不会');
}catch(e){document.getElementById('sub').textContent='读取失败，稍后重试'}}
refresh();setInterval(refresh,20000);
</script></body></html>`;

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/avatar.png') {
    if (AVATAR && existsSync(AVATAR)) {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=600' });
      res.end(readFileSync(AVATAR));
    } else { res.writeHead(404); res.end(); }
    return;
  }
  if (url === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(await state()));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(HTML);
}).listen(PORT, '127.0.0.1', () => console.log('emotion dashboard: http://127.0.0.1:' + PORT));
