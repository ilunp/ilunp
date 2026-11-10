/* ---------------- UI + Web Serial ---------------- */
const C = window.EinkCore;
const $root = document.querySelector('.eink-upload');
const $ = id => $root.querySelector('#' + id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hex32 = v => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const state = { link: null, frame: null, fnv: 0, fnv2: 0, rotate: 180,
  hasImage: false, busy: false, mode: 'otp' };

function log(s) { const el = $('log'); el.textContent += s + '\n'; el.scrollTop = el.scrollHeight; }
function setBar(p) { $('bar').style.width = (Math.max(0, Math.min(1, p)) * 100).toFixed(1) + '%'; }
function setBusy(b) {
  state.busy = b;
  ['btnGen', 'btnPush', 'btnConnect'].forEach(id => { $(id).disabled = b; });
  if (!b) { $('btnPush').disabled = !state.frame; applyAvailability(); }
}
/* 滑块值可能为 0，不能用 || 兜底（会让饱和度 0 失效） */
function numOr(id, fallback) {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : fallback;
}
function params() {
  return {
    mode: $('mode').value,
    orient: $('orient').value, fit: $('fit').value, pad: $('pad').value,
    dither: $('dither').value,
    quality: $('quality').value, style: $('style').value, denoise: $('denoise').value,
    gray: $('gray').checked, serp: $('serp').checked,
    rotate: parseInt($('rotate').value, 10),
    exposure: numOr('exposure', 0),
    contrast: numOr('contrast', 1),
    saturation: numOr('saturation', 1),
    brightness: numOr('brightness', 0),
  };
}
/* ---- 参数可用性：模式 × 来源 × 选项联动 ---- */
const PARAM_LABEL = {
  orient: '自动方向', fit: '填充方式', pad: '留白颜色', dither: '抖动算法',
  quality: '混色质量', style: '呈现风格', denoise: '六色降噪',
  serp: '蛇形扫描', gray: '只用黑白', exposure: '曝光', contrast: '对比度',
  saturation: '饱和度', brightness: '亮度'
};
const DIFFUSION = ['fs', 'atkinson', 'sierra'];
const OPTS = Object.keys(PARAM_LABEL);
const MODE_DESC = {
  otp: 'otp 六色：面板内置波形，单帧 172800 字节。',
  qual512: 'qual512：全白预着色 + 四趟刷新，三 plane 518400 字节，约 70 秒。',
  qual384: 'qual384：六底色块预着色 + 两遍 n0，三 plane 518400 字节，约 50 秒。',
  fast512: 'fast512：全白预着色 + 两帧准备 + n5/n0/n0，三 plane 518400 字节，约 2 分钟。'
};
function applyAvailability() {
  const mode = $('mode').value, q3 = mode !== 'otp';
  const fromFrame = !state.hasImage && !!state.frame;
  const dither = $('dither').value, style = $('style').value, fit = $('fit').value;
  const off = {};
  if (fromFrame) {
    for (const id of OPTS) off[id] = '载入 .bin 帧时不参与';
  } else {
    if (q3) {
      off.pad = '三 plane 色表没有对应的纯色留白索引';
      off.gray = '三 plane 色表固定，不能限制成黑白两色';
      off.denoise = '六色凸包降噪只对 6 色板定义，此处自动关闭';
    } else if (fit === 'cover') {
      off.pad = 'cover 铺满时没有留白区';
    }
    if (DIFFUSION.indexOf(dither) < 0) off.serp = '仅 fs / atkinson / sierra 误差扩散有效';
    if (dither === 'none' || style === 'flat') off.quality = '当前抖动/风格下扩散增益为 0';
  }
  for (const id of OPTS) {
    const el = $(id), wrap = el.closest('.opt'), why = off[id];
    el.disabled = !!why;
    if (wrap) { wrap.classList.toggle('off', !!why); wrap.title = why || ''; }
  }
  $('btnGen').disabled = state.busy || !state.hasImage || fromFrame;
  const names = Object.keys(off).map(id => PARAM_LABEL[id]);
  $('modeNote').textContent = MODE_DESC[mode] +
    (fromFrame ? ' 当前来源是 .bin 帧：除「显示模式 / 安装方向」外全部参数不可用。'
      : names.length ? ' 当前组合下不可用：' + names.join('、') + '。'
        : ' 当前组合下全部参数可用。');
}
function showPreview(rgba) {
  const ctx = $('cv').getContext('2d');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), C.W, C.H), 0, 0);
}
function clearPreview() {
  $('cv').getContext('2d').clearRect(0, 0, C.W, C.H);
}
function paletteForMode(mode) {
  return mode === 'qual384' ? C.PALETTE384
    : mode === 'fast512' ? C.PALETTE_FAST512 : C.PALETTE512;
}
function frameBytesForMode(mode) {
  return C.FRAME_BYTES * (mode !== 'otp' ? 3 : 1);
}
/* 载入 .bin 帧后，预览必须与当前模式/安装方向一致；切换任一参数都调用这里 */
function previewFromFrame() {
  if (!state.frame || state.frame.length !== frameBytesForMode(state.mode)) return;
  if (state.mode === 'otp') {
    showPreview(C.previewIds(C.frameToIds(state.frame, state.rotate)));
    return;
  }
  const g = state.frame.subarray(0, C.FRAME_BYTES),
    a = state.frame.subarray(C.FRAME_BYTES, C.FRAME_BYTES * 2),
    b = state.frame.subarray(C.FRAME_BYTES * 2);
  const ids = C.idsFromQualPlanes512(g, a, b, state.rotate);
  const lim = state.mode === 'qual384' ? 383 : 511;
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] > lim) throw new Error('帧含 ' + ids[i] + ' 号色，超出 ' +
      state.mode + ' 色表范围，请载入对应模式的帧');
  }
  showPreview(C.previewIds512(ids, paletteForMode(state.mode)));
}
function invalidateFrame() {
  state.frame = null; state.fnv = 0; state.fnv2 = 0; state.fnv3 = 0;
  $('fnvLabel').textContent = '';
  $('btnSave').disabled = true; $('btnPush').disabled = true;
  clearPreview();
}

class Link {
  constructor(port) { this.port = port; this.text = ''; this.fatal = null; }
  async open() {
    await this.port.open({ baudRate: 115200, bufferSize: 8192 });
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this._pump();
  }
  async _pump() {
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        this.text += dec.decode(value, { stream: true });
        if (this.text.length > 8192) this.text = this.text.slice(-4096);
      }
    } catch (e) { this.fatal = e.message; }
  }
  clear() { this.text = ''; }
  async write(bytes) { await this.writer.write(bytes); }
  async waitToken(tok, ms) {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      if (this.fatal) throw new Error('串口读错误：' + this.fatal);
      const i = this.text.indexOf(tok);
      if (i >= 0) { this.text = this.text.slice(i + tok.length); return true; }
      await sleep(40);
    }
    return false;
  }
  async waitReply(ms) {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      if (this.fatal) throw new Error('串口读错误：' + this.fatal);
      const m = /OK|ERR/.exec(this.text);
      if (m) { const s = this.text.slice(m.index).trim(); this.text = ''; return s; }
      await sleep(100);
    }
    return null;
  }
  async close() {
    try { await this.reader.cancel(); } catch (e) {}
    try { this.reader.releaseLock(); } catch (e) {}
    try { this.writer.releaseLock(); } catch (e) {}
    try { await this.port.close(); } catch (e) {}
  }
}

async function connect() {
  if (state.link) {
    await state.link.close(); state.link = null;
    $('connState').textContent = '未连接'; $('connState').classList.remove('on');
    $('btnConnect').textContent = '连接串口'; log('已断开串口');
    return;
  }
  try {
    const port = await navigator.serial.requestPort();
    const link = new Link(port);
    await link.open();
    state.link = link;
    $('connState').textContent = '已连接'; $('connState').classList.add('on');
    $('btnConnect').textContent = '断开串口'; log('串口已打开');
  } catch (e) { log('连接失败：' + e.message); }
}

async function loadRGBA(file) {
  const bmp = await createImageBitmap(file);
  const w = bmp.width, h = bmp.height;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, w, h);
  bmp.close();
  return { sw: w, sh: h, data: new Uint8Array(d.data.buffer.slice(0)) };
}

async function generate() {
  const f = $('fileImage').files[0];
  if (!f) { log('请先选择图片'); return; }
  setBusy(true); setBar(0);
  try {
    const img = await loadRGBA(f);
    const p = params();
    log('输入 ' + img.sw + '×' + img.sh + '，屏幕 480×720');
    const orient = C.chooseOrient(img.sw, img.sh, p.orient);
    let { data, sw, sh } = img;
    if (orient !== 'none') {
      const r = C.rotate90(data, sw, sh, orient === 'cw');
      data = r.data; sw = r.sw; sh = r.sh;
      log('自动方向：' + (orient === 'cw' ? '顺时针' : '逆时针') + ' 90° -> ' + sw + '×' + sh);
    } else log('方向：保持 ' + sw + '×' + sh);
    const q3 = p.mode !== 'otp';
    const q384 = p.mode === 'qual384';
    const fast = p.mode === 'fast512';
    const fit = p.fit === 'auto' ? (orient !== 'none' ? 'contain' : 'cover') : p.fit;
    log('模式 ' + p.mode + '，填充：' + fit + '，抖动 ' + p.dither +
      '（蛇形 ' + (p.serp ? 'on' : 'off') + '），参数 ' + p.quality + '/' + p.style);
    let padId = q3 ? undefined : C.PAD_COLORS[p.pad];
    if (padId !== undefined && p.gray && padId !== 0 && padId !== 1) padId = 1;
    const padMask = (fit === 'contain' && padId !== undefined) ?
      new Uint8Array(C.W * C.H) : null;
    const padRgb = padId !== undefined ? C.padRgbOf(padId) : null;
    let rgba = C.resizeRGBA(data, sw, sh, fit, padRgb, padMask);
    rgba = C.adjustRGBA(rgba, p.exposure, p.contrast, p.saturation, p.brightness);
    const t0 = performance.now();
    const q = await C.quantizeAsync(rgba, {
      gray: q3 ? false : p.gray, quality: p.quality, style: p.style,
      denoise: p.denoise, dither: p.dither, serpentine: p.serp,
      palette: q3 ? (q384 ? C.PALETTE384 : fast ? C.PALETTE_FAST512 : C.PALETTE512) : null
    }, pr => setBar(pr * 0.95));
    if (!q3) C.applyPad(q.ids, q.preview, padMask, padId);
    log('抖动完成 ' + (performance.now() - t0).toFixed(0) + ' ms');
    let body, f1, f2 = 0, f3 = 0;
    if (q3) {
      const pl = C.packQualPlanes512(q.ids, p.rotate, q384 ? 383 : 511);
      body = new Uint8Array(C.FRAME_BYTES * 3);
      body.set(pl.g, 0); body.set(pl.a, C.FRAME_BYTES);
      body.set(pl.b, C.FRAME_BYTES * 2);
      f1 = C.fnv1a(pl.g); f2 = C.fnv1a(pl.a); f3 = C.fnv1a(pl.b);
    } else {
      body = C.makeFrame(q.ids, p.rotate);
      f1 = C.fnv1a(body);
    }
    state.frame = body; state.fnv = f1; state.fnv2 = f2; state.fnv3 = f3;
    state.rotate = p.rotate; state.mode = p.mode;
    showPreview(q.preview);
    setBar(1);
    log(q3 ? ((q384 ? '384' : fast ? 'Fast 512' : '512') + ' 色三 plane ' + body.length +
                ' 字节，FNV-1a=' + hex32(f1) + ' / ' + hex32(f2) + ' / ' + hex32(f3))
            : ('帧 ' + body.length + ' 字节，FNV-1a=' + hex32(f1)));
    $('fnvLabel').textContent = q3
      ? ('FNV ' + hex32(f1) + ' / ' + hex32(f2) + ' / ' + hex32(f3))
      : ('FNV ' + hex32(f1));
    $('btnSave').disabled = false; $('btnPush').disabled = false;
  } catch (e) { invalidateFrame(); log('错误：' + e.message); }
  finally { setBusy(false); }
}

async function loadFrameFile(f) {
  const buf = new Uint8Array(await f.arrayBuffer());
  const p = params(), q3 = p.mode !== 'otp';
  const q384 = p.mode === 'qual384';
  const fast = p.mode === 'fast512';
  const want = frameBytesForMode(p.mode);
  if (buf.length !== want)
    throw new Error('帧长度必须是 ' + want + '（' + p.mode + '），实际 ' + buf.length);
  state.rotate = p.rotate; state.mode = p.mode; state.frame = buf;
  if (q3) {
    state.fnv = C.fnv1a(buf.subarray(0, C.FRAME_BYTES));
    state.fnv2 = C.fnv1a(buf.subarray(C.FRAME_BYTES, C.FRAME_BYTES * 2));
    state.fnv3 = C.fnv1a(buf.subarray(C.FRAME_BYTES * 2));
  } else {
    state.fnv = C.fnv1a(buf); state.fnv2 = 0; state.fnv3 = 0;
  }
  try {
    previewFromFrame();
  } catch (e) {
    invalidateFrame();
    throw e;
  }
  $('fnvLabel').textContent = q3
    ? ('FNV ' + hex32(state.fnv) + ' / ' + hex32(state.fnv2) + ' / ' + hex32(state.fnv3))
    : ('FNV ' + hex32(state.fnv));
  $('btnSave').disabled = false; $('btnPush').disabled = false; setBar(1);
  log('载入 ' + (q3 ? (q384 ? '384' : fast ? 'Fast 512' : '512') + ' 色三 plane' : 'raw 帧') + ' ' +
    buf.length + ' 字节，FNV-1a=' + hex32(state.fnv) +
    (q3 ? ' / ' + hex32(state.fnv2) + ' / ' + hex32(state.fnv3) : ''));
}

/* QL48 ver=4/5/6：A/B/C 三段握手。
 * ver=4 的 'A' 之前板子在做 OTP 预着色，ver=6 之前要做全白预着色 +
 * 两帧准备共 3 趟刷新，两者超时都按 3 分钟；
 * ver=5 的 'A' 只等 plane0 的 0x10，很快回来。 */
async function pushQual3Planes(ver) {
  if (!state.link) { log('请先连接串口'); return; }
  if (!state.frame || state.frame.length !== C.FRAME_BYTES * 3) {
    log('请先生成 ' + (ver === 5 ? '384' : ver === 6 ? 'Fast 512' : '512') + ' 色三 plane 帧'); return;
  }
  setBusy(true); setBar(0);
  const link = state.link;
  const planes = [
    state.frame.subarray(0, C.FRAME_BYTES),
    state.frame.subarray(C.FRAME_BYTES, C.FRAME_BYTES * 2),
    state.frame.subarray(C.FRAME_BYTES * 2)
  ];
  const fnvs = planes.map(p => C.fnv1a(p));
  try {
    link.clear();
    log('等待板子引导信号 …');
    if (!await link.waitToken('?', 20000)) throw new Error('20 秒内未收到 ?');
    await link.write(C.buildQualHeader512(fnvs, state.rotate, ver));
    log('已发 QL48 ver=' + ver + ' 帧头，' + (ver === 4
      ? '板子正在做 OTP 预着色（约 30~60 秒）…'
      : ver === 6 ? '板子正在做全白预着色 + 两帧准备（约 1~2 分钟）…'
        : '板子准备接收 plane0（六底色块）…'));
    const tokens = ['A', 'B', 'C'];
    const names = ver === 5 ? ['族', 'a', 'b'] : ['g', 'a', 'b'];
    for (let phase = 0; phase < 3; phase++) {
      const firstWait = phase === 0 ? (ver === 4 || ver === 6 ? 180000 : 30000) : 240000;
      if (!await link.waitToken(tokens[phase], firstWait))
        throw new Error('板子未回 ' + tokens[phase]);
      log('发送 plane ' + names[phase] + ' …');
      const plane = planes[phase];
      for (let off = 0; off < plane.length; off += C.CHUNK) {
        const part = plane.subarray(off, Math.min(off + C.CHUNK, plane.length));
        await link.write(part);
        if (part.length === C.CHUNK && !await link.waitToken('.', 30000))
          throw new Error('plane' + (phase + 1) + ' 流控失步 @' + (off + part.length));
        setBar((phase + (off + part.length) / plane.length) / 3 * 0.98);
      }
    }
    setBar(0.99);
    log('等待末趟刷新完成 …');
    const reply = await link.waitReply(300000);
    if (!reply) throw new Error('等待回执超时');
    log('板子回执：' + reply);
    if (!reply.startsWith('OK')) throw new Error('板子报错：' + reply);
    setBar(1); log('完成 ✓');
  } catch (e) { log('失败：' + e.message); }
  finally { setBusy(false); }
}

async function pushQual512() { return pushQual3Planes(4); }
async function pushQual384() { return pushQual3Planes(5); }
async function pushFast512() { return pushQual3Planes(6); }

async function push() {
  if (!state.frame || state.frame.length !== frameBytesForMode(state.mode)) {
    log('帧长度与当前模式不匹配，请重新生成或载入帧'); return;
  }
  if (state.mode === 'qual512') return pushQual512();
  if (state.mode === 'qual384') return pushQual384();
  if (state.mode === 'fast512') return pushFast512();
  if (!state.link) { log('请先连接串口'); return; }
  if (!state.frame) { log('请先生成或载入帧'); return; }
  setBusy(true); setBar(0);
  const link = state.link, body = state.frame, total = body.length;
  try {
    link.clear();
    log('等待板子引导信号 …');
    if (!await link.waitToken('?', 20000)) throw new Error('20 秒内未收到 ?');
    await link.write(C.buildHeader(state.fnv, state.rotate));
    log('已发帧头，等待 A …');
    if (!await link.waitToken('A', 15000)) throw new Error('板子未回 A');
    log('板子就绪，分块发送 ' + total + ' 字节 …');
    for (let off = 0; off < total; off += C.CHUNK) {
      const part = body.subarray(off, Math.min(off + C.CHUNK, total));
      await link.write(part);
      if (part.length === C.CHUNK && !await link.waitToken('.', 20000)) {
        throw new Error('流控失步 @' + (off + part.length));
      }
      setBar((off + part.length) / total * 0.98);
    }
    setBar(0.99);
    log('帧已发完，等待刷新完成（约 20~30 秒）…');
    const reply = await link.waitReply(180000);
    if (!reply) throw new Error('等待回执超时');
    log('板子回执：' + reply);
    if (!reply.startsWith('OK')) throw new Error('板子报错：' + reply);
    setBar(1); log('完成 ✓');
  } catch (e) { log('失败：' + e.message); }
  finally { setBusy(false); }
}

function saveFrame() {
  if (!state.frame) return;
  if (state.frame.length !== frameBytesForMode(state.mode)) {
    log('帧长度与当前模式不匹配，未导出'); return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([state.frame], { type: 'application/octet-stream' }));
  const name = state.mode === 'otp' ? 'eink_frame.bin'
    : state.mode === 'qual384' ? 'eink_qual384.bin'
      : state.mode === 'fast512' ? 'eink_fast512.bin' : 'eink_qual512.bin';
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  log('已下载 ' + name);
}

$('btnConnect').addEventListener('click', connect);
$('btnGen').addEventListener('click', generate);
$('btnPush').addEventListener('click', push);
$('btnSave').addEventListener('click', saveFrame);
$('fileImage').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  state.hasImage = true;
  $('fileName').textContent = '图片：' + f.name;
  $('fileFrame').value = '';
  applyAvailability();
  generate();
});
$('fileFrame').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  state.hasImage = false;
  $('fileName').textContent = '帧文件：' + f.name;
  $('fileImage').value = '';
  try { await loadFrameFile(f); }
  catch (err) { invalidateFrame(); log('错误：' + err.message); }
  applyAvailability();
});
/* 任一参数变化先重算可用性；有图片时再重算预览 */
OPTS.concat(['mode', 'rotate']).forEach(id => {
  $(id).addEventListener('change', () => {
    applyAvailability();
    if (!state.hasImage && state.frame) {
      const m = $('mode').value;
      if (state.frame.length !== frameBytesForMode(m)) {
        invalidateFrame();
        log('模式切换后帧长度不匹配，请重新选择对应长度的 .bin 帧');
        applyAvailability();
        return;
      }
      const prevMode = state.mode;
      state.mode = m;
      state.rotate = parseInt($('rotate').value, 10);
      try {
        previewFromFrame();
        if (prevMode !== m) log('已按 ' + m + ' 色表重新解释帧数据（帧内容未变）');
      } catch (e) {
        state.mode = prevMode;
        invalidateFrame();
        log('错误：' + e.message);
      }
      return;
    }
    if (state.hasImage && $('fileImage').files[0] && !$(id).disabled) generate();
  });
});

/* 色彩滑块：拖动只刷新数值，松手（change）才重算整屏，避免连续抖动卡住主线程 */
const ADV_DEFAULT = { exposure: 0, contrast: 1, saturation: 1, brightness: 0 };
const ADV_FMT = {
  exposure: v => v === 0 ? '0 EV' : (v > 0 ? '+' : '') + v.toFixed(2) + ' EV',
  contrast: v => v.toFixed(2),
  saturation: v => v.toFixed(2),
  brightness: v => (v > 0 ? '+' : '') + String(v),
};
function syncAdvLabels() {
  for (const id of Object.keys(ADV_DEFAULT)) {
    const v = parseFloat($(id).value);
    $(id + 'Val').textContent = ADV_FMT[id](Number.isFinite(v) ? v : ADV_DEFAULT[id]);
  }
}
Object.keys(ADV_DEFAULT).forEach(id => {
  $(id).addEventListener('input', syncAdvLabels);
  $(id).addEventListener('change', () => {
    syncAdvLabels();
    if (state.hasImage && $('fileImage').files[0]) generate();
  });
});
$('btnAdvReset').addEventListener('click', () => {
  for (const id of Object.keys(ADV_DEFAULT)) $(id).value = String(ADV_DEFAULT[id]);
  syncAdvLabels();
  if (state.hasImage && $('fileImage').files[0]) generate();
});
syncAdvLabels();
applyAvailability();

if (!('serial' in navigator) || !window.isSecureContext) {
  $('btnConnect').disabled = true;
  $('compat').textContent = '当前环境不支持 Web Serial。请使用 Chrome / Edge 桌面版，并通过 http://localhost 或 https 打开本页。';
} else if (location.protocol === 'file:') {
  $('compat').textContent = '当前是 file:// 本地文件，Web Serial 可能不可用；请通过 http://localhost 或 https 打开本站页面。';
} else {
  $('compat').textContent = 'Web Serial 可用。点击「连接串口」，在弹窗中选择 CH573F 的 COM 口（USB 串行设备）。';
}
log('就绪。浏览器：' + navigator.userAgent.split(' ').slice(-1)[0]);