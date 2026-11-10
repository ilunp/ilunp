/* 核心：与 tools/img2eink.py 逐行对齐；六色抖动部分来自社区 3.7einkDvb 的 eink_pipeline.js。
   UMD 包装，浏览器挂到 window.EinkCore，Node 里可 require 做离线校验。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EinkCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const W = 480, H = 720, FRAME_BYTES = W * H / 2, CHUNK = 2048;
  const MODES = { fast: 0.55, standard: 0.85, best: 1.0 };
  /* 误差扩散内核：[前向列偏移, 行偏移, 分子, 分母]，与 img2eink.py 的 KERNELS 一致。
     前向偏移按当前行扫描方向取符号；fs 的四项与旧版顺序完全相同。 */
  const KERNELS = {
    fs: [[1, 0, 7, 16], [-1, 1, 3, 16], [0, 1, 5, 16], [1, 1, 1, 16]],
    atkinson: [[1, 0, 1, 8], [2, 0, 1, 8], [-1, 1, 1, 8],
      [0, 1, 1, 8], [1, 1, 1, 8], [0, 2, 1, 8]],
    sierra: [[1, 0, 5, 32], [2, 0, 3, 32],
      [-2, 1, 2, 32], [-1, 1, 4, 32], [0, 1, 5, 32], [1, 1, 4, 32], [2, 1, 2, 32],
      [-1, 2, 2, 32], [0, 2, 3, 32], [1, 2, 3, 32], [2, 2, 2, 32]],
  };
  const DITHERS = ['fs', 'atkinson', 'sierra', 'bayer', 'multi', 'noise64', 'none'];
  const ORDERED = ['bayer', 'multi', 'noise64'];
  const BAYER8 = [
    0, 48, 12, 60, 3, 51, 15, 63,
    32, 16, 44, 28, 35, 19, 47, 31,
    8, 56, 4, 52, 11, 59, 7, 55,
    40, 24, 36, 20, 43, 27, 39, 23,
    2, 50, 14, 62, 1, 49, 13, 61,
    34, 18, 46, 30, 33, 17, 45, 29,
    10, 58, 6, 54, 9, 57, 5, 53,
    42, 26, 38, 22, 41, 25, 37, 21,
  ];
  /* 递归 2^n 阶 Bayer 矩阵，与 img2eink.py / epd_min 一致 */
  function bayerMatrix(n) {
    if (n === 1) return new Uint8Array([0]);
    const h = n >> 1, half = bayerMatrix(h), out = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const b = half[(y % h) * h + (x % h)];
      const qy = y < h ? 0 : 1, qx = x < h ? 0 : 1;
      const p = (qy === 0) ? (qx === 0 ? 0 : 2) : (qx === 0 ? 3 : 1);
      out[y * n + x] = 4 * b + p;
    }
    return out;
  }
  /* 64x64 golden-ratio 低差异阈值表：无方向性纹路，观感接近蓝噪声。
     (r+0.5)/4096 的分母是 2 的幂，Float32 存得下且与 Python 双精度逐位相同。 */
  function buildLowDiscrepancyTable(n) {
    const a1 = 0.6180339887498949, a2 = 0.3819660112501051;
    const pts = new Array(n * n);
    let x = 0, y = 0;
    for (let k = 0; k < n * n; k++) {
      x = (x + a1) % 1; y = (y + a2) % 1;
      pts[k] = { cy: Math.min(n - 1, (y * n) | 0), cx: Math.min(n - 1, (x * n) | 0), k };
    }
    pts.sort((p, q) => (p.cy - q.cy) || (p.cx - q.cx) || (p.k - q.k));
    const tab = new Float32Array(n * n);
    for (let r = 0; r < pts.length; r++) tab[pts[r].cy * n + pts[r].cx] = (r + 0.5) / pts.length;
    return tab;
  }
  const BAYER16 = bayerMatrix(16);
  const NOISE64 = buildLowDiscrepancyTable(64);
  const BAYER_AMP = 0.22;
  const COLORS = [
    { id: 0, rgb: [0x11, 0x14, 0x12] }, { id: 1, rgb: [0xf4, 0xf3, 0xe8] },
    { id: 2, rgb: [0xe7, 0xc8, 0x3f] }, { id: 3, rgb: [0xc6, 0x3b, 0x35] },
    { id: 5, rgb: [0x31, 0x5e, 0xae] }, { id: 6, rgb: [0x39, 0x84, 0x51] },
  ];
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const LINEAR = Float64Array.from({ length: 256 }, (_, i) => {
    const v = i / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const encodeSrgb = v => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const PALETTE = COLORS.map(c => {
    const lin = c.rgb.map(v => LINEAR[v]);
    return { id: c.id, rgb: c.rgb, lin, lum: 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2] };
  });
  const VALID = new Set([0, 1, 2, 3, 5, 6]);
  const PAD_COLORS = { black: 0, white: 1, yellow: 2, red: 3, blue: 5, green: 6 };

  /* OTP 384 色表：384色分享包，idx = 族<<6 | a<<3 | b（族 0..5）。
   * 与 tools/palette_qual384.csv 同源（359 实测 + 25 推断，两次取色互校）。 */
  const PAL384_RGB = [
    25,28,33,23,25,30,22,26,31,22,25,30,50,50,50,77,65,65,105,76,62,129,97,73,
    23,26,31,18,21,26,17,21,26,17,20,26,45,45,45,74,59,60,106,76,62,127,98,73,
    24,27,32,18,21,27,17,20,25,18,20,25,46,45,45,72,60,60,107,78,64,127,101,77,
    26,29,34,19,21,26,16,20,25,15,18,24,47,47,47,75,60,60,108,79,65,130,105,77,
    30,30,30,37,37,37,42,42,42,48,48,48,71,59,59,92,69,65,114,79,70,133,101,78,
    35,35,35,54,51,52,66,54,54,80,61,61,102,73,69,112,82,75,126,93,76,140,109,84,
    48,46,47,90,61,55,99,70,59,109,80,64,122,91,71,126,99,72,135,108,73,141,119,78,
    61,49,51,111,74,63,123,90,71,133,106,78,139,115,81,143,119,81,147,126,80,145,132,83,
    1,55,100,3,71,110,11,75,113,20,82,117,70,106,126,98,126,133,123,138,135,137,147,142,
    1,66,108,38,96,120,67,110,127,90,124,136,131,146,153,141,153,153,150,160,155,154,160,156,
    10,75,113,67,110,129,104,132,141,139,153,154,150,159,158,154,163,162,162,166,165,160,166,162,
    19,83,118,93,125,138,138,152,153,156,165,164,158,166,164,162,169,167,166,170,169,163,168,165,
    25,85,119,94,126,139,140,154,155,157,166,164,159,168,165,163,169,169,166,170,168,163,169,164,
    26,86,120,97,129,141,144,156,156,160,168,165,159,168,166,164,169,169,166,170,170,162,168,164,
    32,88,121,119,140,145,152,161,160,166,171,168,166,171,169,167,172,169,166,173,166,164,169,163,
    36,91,121,126,144,146,157,163,161,165,170,168,166,172,168,166,172,167,165,171,162,163,168,162,
    50,6,4,77,12,12,79,7,11,81,6,8,94,0,4,101,7,5,101,17,9,114,30,14,
    74,14,13,92,0,3,95,0,2,100,0,0,107,8,3,108,18,8,113,25,10,118,43,13,
    78,8,8,96,0,4,101,0,0,103,0,1,109,5,5,112,20,7,112,26,8,121,47,13,
    81,7,9,99,0,0,102,0,1,104,1,1,110,13,3,114,22,10,120,26,8,126,49,11,
    85,0,5,104,0,1,107,0,2,110,12,3,115,23,10,120,36,10,124,46,11,133,71,11,
    87,0,3,106,0,2,111,1,0,116,19,10,121,37,14,126,50,16,131,59,14,139,82,10,
    93,0,3,106,0,1,112,0,0,120,24,5,126,43,14,131,55,15,135,69,11,141,90,9,
    93,0,1,111,0,0,119,14,5,128,49,14,135,64,17,137,75,14,144,91,9,146,109,7,
    38,46,49,48,50,49,51,53,52,56,58,57,72,71,69,80,81,75,89,87,64,107,102,64,
    47,49,48,64,72,50,79,87,46,97,105,45,105,112,37,110,116,26,119,119,10,128,129,9,
    53,55,54,82,89,48,106,110,29,128,131,10,133,138,9,138,143,8,143,144,8,144,147,8,
    60,60,60,101,104,48,128,129,10,159,159,11,159,161,10,159,162,9,155,158,9,153,154,8,
    61,61,61,101,105,47,129,130,10,160,160,10,160,161,11,159,162,10,155,158,7,152,156,8,
    60,61,61,101,106,44,129,131,9,160,162,10,162,162,12,161,163,9,157,160,8,154,157,8,
    59,59,59,103,104,45,128,127,9,158,159,9,158,161,12,160,160,9,156,159,8,154,156,10,
    61,60,60,104,104,44,128,128,9,156,159,9,158,159,10,158,161,8,156,158,8,153,155,9,
    2,32,67,0,38,75,1,40,80,1,41,84,2,60,97,37,74,100,73,92,99,116,122,118,
    3,40,77,1,50,91,1,52,95,0,53,101,6,65,107,36,84,110,74,103,107,111,126,119,
    3,41,78,0,51,96,1,53,100,0,56,105,7,69,110,38,86,113,78,107,111,114,129,122,
    3,40,81,0,52,101,0,55,105,1,58,112,13,72,114,40,90,116,82,111,115,118,132,127,
    1,41,85,0,59,103,2,66,108,18,74,114,42,90,120,70,105,125,97,125,129,127,142,137,
    2,45,90,0,69,107,16,80,115,49,93,120,71,106,126,88,117,130,111,135,135,135,146,142,
    1,53,86,14,79,102,44,91,108,85,114,119,99,125,124,109,129,127,122,137,130,135,148,139,
    4,60,90,39,88,102,78,108,114,117,132,127,126,140,133,133,146,137,139,151,138,144,155,139,
    1,41,53,1,52,55,4,55,58,7,58,61,15,65,62,36,78,70,57,85,64,82,109,67,
    2,53,55,7,67,59,7,69,60,10,70,60,35,78,62,57,90,69,65,98,63,85,113,64,
    2,55,57,8,69,59,11,70,58,18,74,61,42,84,62,61,93,68,67,102,61,88,115,60,
    7,58,60,13,71,62,21,75,63,26,77,59,49,87,62,65,96,69,75,107,66,90,118,60,
    8,59,61,17,74,63,30,79,63,52,87,63,64,97,71,75,104,74,86,115,66,98,122,60,
    6,61,63,23,77,64,41,83,65,65,95,67,74,104,74,83,111,72,93,120,65,105,128,59,
    8,61,63,35,80,62,51,89,63,74,106,65,83,110,65,89,116,61,102,124,52,110,134,48,
    7,65,67,47,86,65,67,100,68,90,117,62,96,120,58,100,125,56,111,133,44,121,140,43,
  ];
  const PALETTE384 = Array.from({ length: 384 }, (_, i) => {
    const rgb = [PAL384_RGB[i * 3], PAL384_RGB[i * 3 + 1], PAL384_RGB[i * 3 + 2]];
    const lin = rgb.map(v => LINEAR[v]);
    return { id: i, rgb, lin, lum: 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2] };
  });

  /* 完整 512 色表：512色qual 全表，idx = g<<6 | a<<3 | b。
   * 与 tools/palette_qual512.csv 同源（480 实测 + 32 推断，属相对色度）。 */
  const PAL512_RGB = [
    19,22,27,16,20,24,17,21,25,18,21,25,32,33,35,45,46,45,51,51,45,81,66,42,
    20,23,27,19,20,24,19,19,24,20,21,24,30,31,33,39,39,39,47,44,39,77,61,37,
    21,24,29,19,20,23,19,21,24,21,20,24,29,30,32,37,37,37,46,43,38,76,60,38,
    21,24,28,19,20,25,20,20,24,18,20,24,30,30,32,36,36,36,47,43,38,76,59,37,
    23,25,27,27,28,30,28,29,30,31,31,33,37,38,37,46,46,46,57,54,47,86,69,46,
    27,28,29,33,33,33,35,36,35,40,39,39,47,47,46,55,55,53,70,63,50,96,77,51,
    28,28,28,36,35,33,40,39,36,47,45,40,54,51,43,63,57,45,80,64,38,101,78,42,
    34,32,31,54,41,33,65,49,35,77,60,36,84,67,41,92,73,45,105,82,39,115,92,26,
    9,47,84,15,62,97,20,66,101,29,73,107,71,99,120,100,117,128,121,130,129,133,138,137,
    12,57,91,45,83,107,66,98,118,87,115,129,124,137,143,137,147,149,149,153,152,148,153,152,
    24,65,99,68,100,120,99,123,134,133,144,149,145,155,156,151,159,159,158,162,161,156,159,158,
    34,74,108,90,116,131,133,145,148,153,162,161,158,164,164,160,165,163,163,167,166,159,163,161,
    35,75,108,92,118,131,135,146,149,156,163,163,159,164,163,160,165,164,165,168,166,159,163,162,
    34,76,108,95,119,131,136,147,149,158,163,162,159,165,163,160,166,164,163,169,164,158,163,161,
    42,79,106,113,127,134,146,154,153,162,166,165,163,169,165,164,169,166,165,170,164,159,164,159,
    49,84,107,121,132,133,150,153,152,162,167,163,163,168,163,163,168,164,164,169,163,159,164,158,
    6,23,58,3,30,64,5,34,67,5,36,71,23,51,79,50,66,84,77,79,80,102,102,96,
    3,32,66,7,39,73,13,42,77,14,45,80,35,60,87,59,74,92,85,88,89,107,107,103,
    2,32,67,9,42,77,12,45,81,14,49,84,39,63,93,63,78,96,90,93,94,111,111,109,
    2,34,70,10,45,81,12,49,85,15,54,89,45,69,98,70,85,103,97,100,101,118,118,116,
    3,37,73,17,56,89,28,62,94,47,70,100,70,87,105,89,97,108,113,115,114,129,129,127,
    11,41,76,32,65,92,50,75,101,72,88,105,91,100,110,107,110,115,123,125,124,135,136,134,
    22,48,74,52,71,88,70,85,96,99,104,106,112,114,113,120,122,121,131,131,130,137,139,133,
    36,56,78,71,80,87,95,98,99,124,125,123,134,134,132,139,140,137,143,146,137,146,148,138,
    1,37,73,2,47,80,1,50,83,1,52,86,4,63,93,30,76,97,71,97,95,101,117,105,
    3,49,82,2,62,89,2,64,91,2,66,95,24,76,97,51,91,103,83,110,102,104,122,108,
    3,51,84,2,65,91,4,68,95,5,70,98,30,81,102,59,96,106,89,115,106,108,125,112,
    2,54,87,4,68,94,7,71,97,12,75,101,39,87,104,67,104,111,95,120,110,112,129,116,
    2,55,89,6,71,96,17,76,99,34,85,104,59,98,111,79,111,117,101,126,115,117,132,121,
    1,56,91,12,75,99,30,84,104,58,98,111,72,109,117,87,118,121,108,129,120,121,136,126,
    2,61,90,31,84,96,56,99,102,85,116,111,96,124,115,105,128,116,118,136,120,126,142,121,
    3,67,93,45,93,97,73,109,105,108,131,118,114,135,121,121,139,125,129,146,119,133,149,116,
    58,10,7,79,8,9,82,6,9,84,5,7,97,1,2,106,7,4,107,15,7,112,25,12,
    78,10,10,95,0,1,98,0,0,101,0,1,109,4,2,114,12,5,117,14,5,121,32,10,
    80,8,9,97,0,1,102,0,1,103,0,2,111,8,4,117,15,8,119,16,7,124,39,12,
    82,8,9,99,0,1,104,0,2,105,1,2,112,10,5,117,16,8,121,19,7,125,41,12,
    89,5,5,105,0,2,110,0,2,112,9,4,120,25,10,124,38,12,129,46,10,134,69,12,
    92,4,4,108,0,2,113,0,1,118,15,10,124,37,12,131,52,14,134,60,13,138,81,10,
    93,3,4,109,0,1,116,3,2,122,16,10,128,40,13,134,53,14,138,64,13,141,85,9,
    95,2,4,114,3,1,123,13,10,129,39,14,137,58,17,142,69,17,145,86,11,148,104,8,
    27,27,29,27,27,27,29,28,28,29,29,29,44,40,41,66,46,48,89,53,46,112,67,53,
    28,28,30,32,32,32,32,33,33,34,35,35,56,44,46,81,51,50,98,60,52,116,73,61,
    29,29,31,34,33,33,36,35,35,42,39,40,60,46,49,85,51,52,101,62,56,119,78,67,
    30,30,31,35,35,35,40,38,39,46,42,43,68,48,50,92,53,54,106,66,60,122,83,74,
    30,30,30,48,41,43,57,46,48,71,49,52,93,54,55,106,62,62,120,76,70,132,98,87,
    38,35,36,62,42,44,76,48,52,94,55,56,106,63,63,115,73,72,126,88,79,137,111,96,
    47,38,39,75,41,40,89,52,48,107,66,59,118,73,67,124,79,73,131,96,77,137,114,87,
    59,44,45,91,48,43,107,60,54,124,82,73,131,98,80,136,110,88,141,118,85,141,128,87,
    13,47,44,15,58,48,15,60,49,14,61,48,28,71,50,46,79,54,52,86,49,70,101,51,
    16,56,46,27,70,43,33,74,41,40,78,42,54,90,45,62,97,44,73,103,34,86,111,26,
    19,59,47,35,75,42,45,81,41,52,88,41,64,97,41,71,102,37,82,109,21,94,117,14,
    19,60,48,41,78,42,52,87,40,62,94,38,71,102,35,76,106,28,88,114,11,103,122,11,
    20,62,49,45,82,42,57,92,41,71,101,33,76,106,29,81,110,22,96,120,8,110,128,13,
    20,62,50,47,83,42,60,95,41,77,106,30,83,111,22,87,113,17,105,125,10,115,133,11,
    21,64,52,51,87,42,69,101,35,90,115,13,97,120,8,102,123,9,115,134,8,126,140,8,
    25,65,55,58,91,43,78,106,31,105,124,9,110,130,9,114,133,8,129,143,7,136,147,7,
    34,34,34,45,44,42,50,48,46,53,52,49,68,65,56,83,76,57,96,79,50,111,93,46,
    43,42,40,73,67,38,91,86,36,106,102,16,112,107,8,116,113,6,130,121,5,139,131,6,
    48,47,44,96,88,35,114,108,7,135,130,5,141,137,5,145,141,6,153,145,5,155,150,6,
    49,48,46,109,103,14,137,132,5,161,158,5,165,161,5,165,162,5,165,161,6,162,158,6,
    51,50,47,109,104,14,138,133,5,164,160,6,166,164,5,167,165,5,166,161,7,162,158,7,
    52,51,49,110,106,15,138,134,6,164,160,7,167,164,6,167,163,6,165,161,7,161,158,7,
    52,51,48,110,102,15,137,132,6,162,157,8,165,160,8,166,161,6,165,160,7,161,158,6,
    54,53,50,109,103,18,136,130,7,160,155,7,164,159,8,164,160,8,163,159,7,159,156,6,
  ];
  const PALETTE512 = Array.from({ length: 512 }, (_, i) => {
    const rgb = [PAL512_RGB[i * 3], PAL512_RGB[i * 3 + 1], PAL512_RGB[i * 3 + 2]];
    const lin = rgb.map(v => LINEAR[v]);
    return { id: i, rgb, lin, lum: 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2] };
  });
  const PAL_FAST512_RGB = [
    27,28,32,27,28,30,27,28,31,26,27,31,42,42,42,57,56,54,69,60,51,101,73,52,
    23,26,30,23,24,26,22,24,26,22,23,26,35,35,35,51,50,48,62,53,44,100,68,43,
    23,26,31,23,24,28,22,23,27,23,23,27,36,36,36,49,49,49,63,54,45,102,72,48,
    21,25,29,21,22,26,21,23,27,20,23,27,36,35,35,49,48,47,64,55,46,100,72,48,
    27,28,28,33,32,32,34,34,34,37,36,36,52,50,48,64,61,56,83,66,48,110,80,52,
    32,32,32,44,43,41,48,47,45,54,51,46,69,62,56,87,69,57,103,77,55,119,87,53,
    31,31,31,45,42,37,49,46,38,56,50,38,70,59,39,87,65,41,99,70,40,115,80,34,
    48,35,35,72,48,33,83,58,36,94,67,40,104,77,40,111,83,38,118,87,26,128,101,26,
    34,34,36,40,40,40,41,41,41,44,43,43,59,57,56,78,66,63,98,72,59,115,83,64,
    41,42,41,56,55,53,60,59,57,63,62,60,85,74,70,103,82,73,115,90,70,127,103,75,
    43,43,43,61,60,58,66,65,63,70,69,67,94,81,75,111,91,80,121,98,76,131,111,83,
    44,44,44,64,63,61,69,68,66,74,73,71,101,83,80,115,96,88,126,105,81,137,117,90,
    51,51,51,75,71,69,85,80,78,107,88,81,120,102,90,127,113,103,137,125,105,142,136,112,
    55,55,55,80,77,71,98,83,76,120,99,85,129,113,97,133,122,106,140,132,107,145,141,113,
    57,57,57,91,77,65,107,88,71,126,104,80,134,119,91,137,127,95,141,134,87,143,140,91,
    62,62,62,101,84,68,119,101,79,134,115,84,140,131,94,142,138,98,143,141,87,145,146,89,
    32,39,47,51,54,59,56,59,64,64,63,69,84,81,82,100,90,89,113,103,93,127,119,107,
    46,46,46,71,70,68,84,80,79,96,91,89,118,115,110,127,126,122,137,134,121,143,142,129,
    54,54,55,86,80,80,102,97,96,122,120,114,134,135,131,141,141,139,146,148,138,150,152,141,
    62,62,67,97,92,91,122,119,114,142,143,138,146,147,144,149,150,146,153,154,147,153,155,148,
    64,65,69,100,96,95,125,124,121,146,147,143,150,151,146,152,153,148,156,157,149,154,157,148,
    66,66,71,103,99,98,127,127,125,148,149,144,151,152,147,154,155,150,157,158,150,156,159,151,
    71,71,73,109,104,98,135,135,129,153,154,146,157,157,149,158,159,150,157,159,145,157,159,144,
    74,74,75,118,110,103,140,140,133,155,156,147,158,159,151,158,160,151,160,161,143,159,161,142,
    23,32,44,25,33,51,23,34,52,22,34,52,47,51,60,65,65,67,77,76,74,113,95,79,
    26,36,51,32,40,58,35,42,61,36,42,61,56,59,68,73,73,75,86,82,81,117,99,87,
    27,36,53,34,42,61,37,44,63,40,47,65,59,62,69,74,74,74,89,83,83,117,103,94,
    28,36,54,36,44,63,41,48,67,44,51,69,65,66,70,77,77,77,95,85,84,120,107,98,
    33,41,57,51,57,70,60,63,71,68,69,73,82,80,81,94,84,85,111,100,97,127,117,110,
    39,45,57,66,66,72,76,76,78,83,81,82,95,85,86,107,95,95,121,110,105,132,125,117,
    47,50,55,73,73,73,83,82,80,100,92,90,112,101,94,120,109,100,131,118,105,137,131,116,
    59,59,61,87,80,80,106,95,91,122,112,103,132,126,114,136,132,120,143,136,117,146,144,124,
    11,42,70,14,50,75,16,52,77,17,55,79,46,70,87,66,83,95,92,96,95,110,111,106,
    14,51,76,31,68,86,35,70,89,39,73,92,69,90,101,91,106,108,108,114,110,120,126,116,
    17,55,77,36,71,90,41,75,94,48,81,98,79,99,107,100,114,114,115,121,117,127,133,123,
    16,57,79,38,75,93,44,80,97,52,85,102,85,105,111,105,118,118,120,127,120,131,137,125,
    22,60,83,50,84,96,64,94,103,85,107,111,106,120,119,119,128,125,130,136,129,138,143,132,
    28,63,82,61,90,99,78,104,106,106,120,117,118,128,124,128,135,133,136,142,132,143,147,135,
    39,67,82,75,95,94,95,110,103,117,128,120,128,136,125,134,141,128,141,148,121,145,152,118,
    49,70,84,92,102,97,112,120,113,133,139,125,139,147,126,142,150,126,145,153,112,147,154,109,
    35,20,17,43,15,14,42,13,11,41,13,11,69,22,17,84,29,19,89,35,23,105,43,23,
    42,15,14,64,21,15,68,23,15,70,25,13,85,33,20,95,39,24,99,44,23,112,51,17,
    43,14,13,69,24,17,73,26,14,75,27,15,88,36,23,95,43,26,102,46,23,115,54,17,
    45,15,14,72,26,18,74,27,15,76,28,17,89,38,25,97,45,27,104,48,25,117,58,17,
    56,17,18,80,29,17,85,35,18,93,42,25,103,51,29,109,60,27,115,61,19,127,78,13,
    63,23,20,87,33,21,92,38,20,101,50,28,111,62,27,117,72,26,123,76,22,132,93,13,
    70,26,21,90,32,20,98,39,21,106,50,23,115,63,21,121,73,20,127,78,14,137,97,10,
    78,29,24,99,32,16,111,45,19,121,62,19,128,76,15,132,86,17,139,99,10,144,115,10,
    33,33,33,47,43,42,49,45,44,51,47,47,69,63,57,89,71,59,98,76,53,114,85,58,
    47,43,44,64,60,50,71,67,56,76,74,58,93,90,61,106,98,61,114,97,48,124,110,37,
    49,46,45,71,68,55,81,77,58,87,85,62,102,103,62,113,111,62,119,110,41,129,119,35,
    49,48,46,76,73,58,85,83,60,93,94,63,107,111,61,116,117,58,123,114,35,134,125,34,
    52,52,52,83,76,57,92,91,61,110,110,60,118,118,55,120,122,48,131,125,35,140,135,36,
    54,54,54,86,79,54,99,96,61,116,116,55,120,121,47,127,126,44,137,131,35,144,139,38,
    60,56,56,96,78,54,110,98,56,124,117,37,129,124,33,133,128,35,144,135,30,150,141,31,
    68,58,59,107,83,56,123,106,46,136,127,34,141,134,31,145,138,33,151,144,28,157,148,28,
    47,35,35,63,49,49,68,56,56,73,61,59,102,80,69,117,90,75,121,94,66,133,110,65,
    65,42,42,97,61,42,111,78,50,119,96,47,127,111,34,131,120,32,142,129,25,147,140,24,
    71,50,49,112,78,49,128,104,38,139,125,30,146,136,29,150,140,29,155,150,24,157,152,26,
    76,58,56,123,96,47,139,124,30,153,145,29,158,150,27,160,152,30,162,159,30,162,158,29,
    75,61,59,123,101,44,141,131,30,158,149,28,160,152,28,159,153,30,164,159,31,161,158,29,
    74,62,61,125,105,47,141,134,36,156,150,36,158,153,37,159,155,38,161,159,36,160,158,35,
    75,62,59,124,107,41,144,137,32,161,157,35,163,157,35,162,159,36,164,161,33,162,159,31,
    70,64,62,122,110,44,143,137,31,158,156,33,161,159,34,161,160,35,163,160,31,160,159,31
  ];
  const PALETTE_FAST512 = Array.from({ length: 512 }, (_, i) => {
    const rgb = [PAL_FAST512_RGB[i * 3], PAL_FAST512_RGB[i * 3 + 1], PAL_FAST512_RGB[i * 3 + 2]];
    const lin = rgb.map(v => LINEAR[v]);
    return { id: i, rgb, lin, lum: 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2] };
  });

  /* ---- 六色线性色域凸包 ---- */
  function buildHull(style) {
    const w = (style === 'illustration' ? [1, 1, 1] : [0.3, 0.5, 0.2]).map(Math.sqrt);
    const pts = PALETTE.map(c => c.lin.map((v, i) => v * w[i])), faces = [];
    const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) for (let k = j + 1; k < 6; k++) {
      const a = pts[i], b = pts[j], c = pts[k];
      const u = b.map((v, n) => v - a[n]), v = c.map((t, n) => t - a[n]);
      let normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const norm = Math.hypot(...normal);
      if (norm < 1e-10) continue;
      normal = normal.map(t => t / norm);
      const sides = pts.map(p => normal.reduce((s, t, n) => s + t * (p[n] - a[n]), 0));
      if (Math.min(...sides) < -1e-8 && Math.max(...sides) > 1e-8) continue;
      if (Math.max(...sides) > 1e-8) normal = normal.map(t => -t);
      const uu = dot(u, u), uv = dot(u, v), vv = dot(v, v);
      const edges = [[a, b], [b, c], [c, a]].map(([ea, eb]) => {
        const d = eb.map((t, n) => t - ea[n]);
        return { a: ea, d, n: dot(d, d) };
      });
      faces.push({ a, u, v, normal, uu, uv, vv, det: uu * vv - uv * uv, edges });
    }
    return { w, faces };
  }
  function projectSixColor(r, g, b, hull, out) {
    const x = r * hull.w[0], y = g * hull.w[1], z = b * hull.w[2];
    let outside = false;
    for (const f of hull.faces) {
      if (f.normal[0] * (x - f.a[0]) + f.normal[1] * (y - f.a[1]) + f.normal[2] * (z - f.a[2]) > 1e-8) {
        outside = true; break;
      }
    }
    if (!outside) { out[0] = r; out[1] = g; out[2] = b; return; }
    let distance = Infinity, bx = x, by = y, bz = z;
    for (const f of hull.faces) {
      const h = f.normal[0] * (x - f.a[0]) + f.normal[1] * (y - f.a[1]) + f.normal[2] * (z - f.a[2]);
      const qx = x - h * f.normal[0], qy = y - h * f.normal[1], qz = z - h * f.normal[2];
      const tx = qx - f.a[0], ty = qy - f.a[1], tz = qz - f.a[2];
      const tu = tx * f.u[0] + ty * f.u[1] + tz * f.u[2];
      const tv = tx * f.v[0] + ty * f.v[1] + tz * f.v[2];
      const s = (tu * f.vv - tv * f.uv) / f.det, t = (tv * f.uu - tu * f.uv) / f.det;
      if (s >= 0 && t >= 0 && s + t <= 1) {
        const d = (x - qx) ** 2 + (y - qy) ** 2 + (z - qz) ** 2;
        if (d < distance) { distance = d; bx = qx; by = qy; bz = qz; }
      } else for (const e of f.edges) {
        const u = clamp(((x - e.a[0]) * e.d[0] + (y - e.a[1]) * e.d[1] + (z - e.a[2]) * e.d[2]) / e.n, 0, 1);
        const px = e.a[0] + u * e.d[0], py = e.a[1] + u * e.d[1], pz = e.a[2] + u * e.d[2];
        const d = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2;
        if (d < distance) { distance = d; bx = px; by = py; bz = pz; }
      }
    }
    out[0] = bx / hull.w[0]; out[1] = by / hull.w[1]; out[2] = bz / hull.w[2];
  }
  function sixColorRow(rgba, y, row, range) {
    for (let x = 0; x < W; x++) {
      const center = (y * W + x) * 4;
      let r = 0, g = 0, b = 0, total = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= W) continue;
          const j = (yy * W + xx) * 4;
          const delta = Math.max(Math.abs(rgba[j] - rgba[center]), Math.abs(rgba[j + 1] - rgba[center + 1]),
            Math.abs(rgba[j + 2] - rgba[center + 2]), Math.abs(rgba[j + 3] - rgba[center + 3]));
          const wgt = range[delta] * (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
          if (!wgt) continue;
          const a = rgba[j + 3] / 255;
          r += wgt * (LINEAR[rgba[j]] * a + 1 - a);
          g += wgt * (LINEAR[rgba[j + 1]] * a + 1 - a);
          b += wgt * (LINEAR[rgba[j + 2]] * a + 1 - a);
          total += wgt;
        }
      }
      row[x * 3] = r / total; row[x * 3 + 1] = g / total; row[x * 3 + 2] = b / total;
    }
  }
  async function quantizeAsync(rgba, options, onProgress) {
    const o = options || {};
    const gray = !!o.gray, quality = o.quality || 'best', style = o.style || 'photo',
      denoise = o.denoise || 'off', dither = o.dither || 'fs',
      serpentine = o.serpentine !== false, custom = o.palette || null;
    if (!rgba || rgba.length !== W * H * 4) throw new Error('裁剪图尺寸必须为 480×720 RGBA');
    if (!Object.prototype.hasOwnProperty.call(MODES, quality)) throw new Error('未知混色质量');
    if (DITHERS.indexOf(dither) < 0) throw new Error('未知抖动算法');
    const diffusion = Object.prototype.hasOwnProperty.call(KERNELS, dither);
    const ordered = ORDERED.indexOf(dither) >= 0;
    const kernel = KERNELS[dither] || [];
    let clean = style !== 'flat' && denoise !== 'off';
    /* 六色凸包投影只对 6 色调色板定义，自定义调色板下自动关闭 */
    if (custom && custom.length !== 6) clean = false;
    const strong = denoise === 'strong';
    const range = clean ? Float64Array.from({ length: 256 }, (_, d) =>
      d > (strong ? 48 : 32) ? 0 : Math.exp(-d * d / (2 * (strong ? 20 : 12) ** 2))) : null;
    const filtered = clean ? new Float64Array(W * 3) : null;
    const hull = clean && !gray ? buildHull(style) : null;
    const projected = clean ? new Float64Array(3) : null;
    const base = custom || PALETTE;
    const inks = gray ? base.slice(0, 2) : base;
    const gain = (style === 'flat' || !diffusion) ? 0 : (gray ? 1 : MODES[quality]);
    const ids = new Uint16Array(W * H);  /* 16 位索引：512 色需 9bit */
    const preview = new Uint8ClampedArray(ids.length * 4);
    const length = (W + 2) * 3;
    const rows = diffusion ? Array.from(
      { length: kernel.reduce((m, k) => Math.max(m, k[1]), 0) + 1 },
      () => new Float64Array(length)) : null;
    const bayerAmp = ordered ? MODES[quality] * BAYER_AMP : 0;
    for (let y = 0; y < H; y++) {
      if (clean) sixColorRow(rgba, y, filtered, range);
      const dir = (serpentine && (y & 1)) ? -1 : 1;
      for (let step = 0; step < W; step++) {
        const x = dir === 1 ? step : W - 1 - step;
        const i = y * W + x, e = (x + 1) * 3, src = i * 4;
        const alpha = rgba[src + 3] / 255;
        let r = LINEAR[rgba[src]] * alpha + (1 - alpha);
        let g = LINEAR[rgba[src + 1]] * alpha + (1 - alpha);
        let b = LINEAR[rgba[src + 2]] * alpha + (1 - alpha);
        if (clean) { r = filtered[x * 3]; g = filtered[x * 3 + 1]; b = filtered[x * 3 + 2]; }
        const chroma = clean ? encodeSrgb(Math.max(r, g, b)) - encodeSrgb(Math.min(r, g, b)) : 0;
        const neutral = clean && chroma <= (strong ? 20 : 12);
        const pixelMono = gray || neutral;
        const blend = clean ? clamp((chroma - (strong ? 20 : 12)) / 20, 0, 1) : 1;
        const colorGain = blend * blend * (3 - 2 * blend);
        const neutralBias = (clean && !pixelMono) ? 1 - colorGain : 0;
        if (hull && !neutral) { projectSixColor(r, g, b, hull, projected); r = projected[0]; g = projected[1]; b = projected[2]; }
        if (gray || neutral) r = g = b = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (gain) {
          const row = rows[0];
          if (pixelMono) {
            const v = 0.2126 * row[e] + 0.7152 * row[e + 1] + 0.0722 * row[e + 2];
            r += v; g += v; b += v;
          } else { r += row[e]; g += row[e + 1]; b += row[e + 2]; }
        }
        if (ordered) {
          let tv;
          if (dither === 'bayer') {
            tv = (BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64 - 0.5;
          } else if (dither === 'multi') {
            tv = 0.5 * (BAYER8[(y & 7) * 8 + (x & 7)] / 64)
              + 0.5 * (BAYER16[(y & 15) * 16 + (x & 15)] / 256) - 0.5;
          } else {
            tv = NOISE64[(y & 63) * 64 + (x & 63)] - 0.5;
          }
          const t = tv * bayerAmp;
          r += t; g += t; b += t;
        }
        let best = inks[0], distance = Infinity;
        for (const ink of inks) {
          if (neutral && ink.id !== 0 && ink.id !== 1) continue;
          const dr = r - ink.lin[0], dg = g - ink.lin[1], db = b - ink.lin[2];
          const d = pixelMono ? (r - ink.lum) ** 2 :
            (style === 'illustration' ? dr * dr + dg * dg + db * db : 0.3 * dr * dr + 0.5 * dg * dg + 0.2 * db * db);
          const score = d + ((neutralBias && ink.id !== 0 && ink.id !== 1) ? 0.5 * neutralBias * neutralBias : 0);
          if (score < distance) { best = ink; distance = score; }
        }
        ids[i] = best.id;
        preview[src] = best.rgb[0]; preview[src + 1] = best.rgb[1];
        preview[src + 2] = best.rgb[2]; preview[src + 3] = 255;
        if (gain) {
          const lumErr = 0.2126 * (r - best.lin[0]) + 0.7152 * (g - best.lin[1]) + 0.0722 * (b - best.lin[2]);
          for (let c = 0; c < 3; c++) {
            const value = c === 0 ? r : c === 1 ? g : b;
            let residual = value - (pixelMono ? best.lum : best.lin[c]);
            if (clean && !pixelMono) residual = lumErr + (residual - lumErr) * colorGain;
            const error = clamp(residual, -1, 1) * (pixelMono ? 1 : gain);
            for (let n = 0; n < kernel.length; n++) {
              const k = kernel[n];
              const j = e + k[0] * dir * 3 + c;
              if (j >= 0 && j < length) rows[k[1]][j] += error * k[2] / k[3];
            }
          }
        }
      }
      if (diffusion) { const row = rows.shift(); row.fill(0); rows.push(row); }
      if ((y & 15) === 15) {
        if (onProgress) onProgress((y + 1) / H);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    return { ids, preview: new Uint8Array(preview.buffer) };
  }
  async function quantize(rgba, options) { return quantizeAsync(rgba, options); }

  /* ---- 图像几何：与 Python 版 choose_orient / rotate90_rgba / cover_resize / adjust 一致 ---- */
  function chooseOrient(sw, sh, mode) {
    if (mode !== 'auto') return mode;
    const a = sw / sh, target = W / H;
    const d0 = Math.abs(Math.log(a / target)), d90 = Math.abs(Math.log((1 / a) / target));
    return d90 + 0.05 < d0 ? 'cw' : 'none';
  }
  function rotate90(src, sw, sh, clockwise) {
    const nw = sh, nh = sw, out = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const nx = clockwise ? sh - 1 - y : y;
      const ny = clockwise ? x : sw - 1 - x;
      const s = (y * sw + x) * 4, d = (ny * nw + nx) * 4;
      out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = src[s + 3];
    }
    return { sw: nw, sh: nh, data: out };
  }
  function resizeRGBA(src, sw, sh, fit, padRgb, padMask) {
    const out = new Uint8Array(W * H * 4);
    const pad = padRgb || [255, 255, 255];
    let xs, ys;
    if (fit === 'contain') {
      const scale = Math.min(W / sw, H / sh), dw = sw * scale, dh = sh * scale;
      const x0 = (W - dw) / 2, y0 = (H - dh) / 2;
      xs = Array.from({ length: W }, (_, x) =>
        (x0 <= x + 0.5 && x + 0.5 <= x0 + dw) ? (x + 0.5 - x0) / scale - 0.5 : null);
      ys = Array.from({ length: H }, (_, y) =>
        (y0 <= y + 0.5 && y + 0.5 <= y0 + dh) ? (y + 0.5 - y0) / scale - 0.5 : null);
    } else {
      const scale = Math.max(W / sw, H / sh), cw = W / scale, ch = H / scale;
      const x0 = (sw - cw) / 2, y0 = (sh - ch) / 2;
      xs = Array.from({ length: W }, (_, x) => x0 + (x + 0.5) * (cw / W) - 0.5);
      ys = Array.from({ length: H }, (_, y) => y0 + (y + 0.5) * (ch / H) - 0.5);
    }
    let o = 0;
    for (let iy = 0; iy < H; iy++) {
      const sy = ys[iy];
      for (let ix = 0; ix < W; ix++) {
        const sx = xs[ix];
        let r, g, b, a;
        if (sx === null || sy === null) {
          r = pad[0]; g = pad[1]; b = pad[2]; a = 255;
          if (padMask) padMask[o / 4] = 1;
        }
        else {
          let px = Math.floor(sx), py = Math.floor(sy);
          const fx = sx - px, fy = sy - py;
          px = clamp(px, 0, sw - 1); py = clamp(py, 0, sh - 1);
          const px2 = Math.min(px + 1, sw - 1), py2 = Math.min(py + 1, sh - 1);
          const p00 = (py * sw + px) * 4, p10 = (py * sw + px2) * 4;
          const p01 = (py2 * sw + px) * 4, p11 = (py2 * sw + px2) * 4;
          const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
          const w01 = (1 - fx) * fy, w11 = fx * fy;
          r = src[p00] * w00 + src[p10] * w10 + src[p01] * w01 + src[p11] * w11;
          g = src[p00 + 1] * w00 + src[p10 + 1] * w10 + src[p01 + 1] * w01 + src[p11 + 1] * w11;
          b = src[p00 + 2] * w00 + src[p10 + 2] * w10 + src[p01 + 2] * w01 + src[p11 + 2] * w11;
          a = src[p00 + 3] * w00 + src[p10 + 3] * w10 + src[p01 + 3] * w01 + src[p11 + 3] * w11;
        }
        out[o++] = Math.floor(r); out[o++] = Math.floor(g);
        out[o++] = Math.floor(b); out[o++] = Math.floor(a);
      }
    }
    return out;
  }
  /* contain 留白区：抖动后直接写墨水色 ID，绕过量化，保证纯净单色 */
  function padRgbOf(colorId) {
    const c = COLORS.find(v => v.id === colorId);
    if (!c) throw new Error('未知留白色');
    return c.rgb;
  }
  function applyPad(ids, preview, mask, colorId) {
    if (!mask) return;
    const rgb = padRgbOf(colorId);
    for (let i = 0; i < mask.length; i++) if (mask[i]) {
      ids[i] = colorId;
      const o = i * 4;
      preview[o] = rgb[0]; preview[o + 1] = rgb[1];
      preview[o + 2] = rgb[2]; preview[o + 3] = 255;
    }
  }
  function adjustRGBA(rgba, exposure, contrast, saturation, brightness) {
    if (exposure === 0 && contrast === 1 && saturation === 1 && brightness === 0) return rgba;
    const mul = Math.pow(2, exposure);
    for (let i = 0; i < rgba.length; i += 4) {
      let r = rgba[i] * mul, g = rgba[i + 1] * mul, b = rgba[i + 2] * mul;
      r = (r - 128) * contrast + 128 + brightness;
      g = (g - 128) * contrast + 128 + brightness;
      b = (b - 128) * contrast + 128 + brightness;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      rgba[i] = Math.floor(clamp(lum + (r - lum) * saturation, 0, 255));
      rgba[i + 1] = Math.floor(clamp(lum + (g - lum) * saturation, 0, 255));
      rgba[i + 2] = Math.floor(clamp(lum + (b - lum) * saturation, 0, 255));
    }
    return rgba;
  }

  /* ---- 帧 / 协议 ---- */
  function makeFrame(ids, rotate) {
    if (!ids || ids.length !== W * H) throw new Error('像素数量错误');
    const body = new Uint8Array(FRAME_BYTES);
    let off = 0;
    for (let x = W - 1; x >= 0; x--) for (let y = 0; y < H; y += 2) {
      let ia, ib;
      if (rotate === 180) { ia = (H - 1 - y) * W + (W - 1 - x); ib = (H - 2 - y) * W + (W - 1 - x); }
      else { ia = y * W + x; ib = (y + 1) * W + x; }
      const a = ids[ia], b = ids[ib];
      if (!VALID.has(a) || !VALID.has(b)) throw new Error('六色帧包含无效色号');
      body[off++] = (a << 4) | b;
    }
    return body;
  }
  function frameToIds(body, rotate) {
    if (!body || body.length !== FRAME_BYTES) throw new Error('帧长度必须为 172800');
    const ids = new Uint8Array(W * H);
    let off = 0;
    for (let x = W - 1; x >= 0; x--) for (let y = 0; y < H; y += 2) {
      const v = body[off++], a = v >> 4, b = v & 15;
      let ia, ib;
      if (rotate === 180) { ia = (H - 1 - y) * W + (W - 1 - x); ib = (H - 2 - y) * W + (W - 1 - x); }
      else { ia = y * W + x; ib = (y + 1) * W + x; }
      ids[ia] = a; ids[ib] = b;
    }
    return ids;
  }
  function previewIds(ids) {
    const lookup = [];
    for (const c of PALETTE) lookup[c.id] = c.rgb;
    const out = new Uint8Array(ids.length * 4);
    for (let i = 0; i < ids.length; i++) {
      const rgb = lookup[ids[i]] || [255, 0, 255];
      out[i * 4] = rgb[0]; out[i * 4 + 1] = rgb[1]; out[i * 4 + 2] = rgb[2]; out[i * 4 + 3] = 255;
    }
    return out;
  }
  function fnv1a(bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
    return h >>> 0;
  }
  function buildHeader(fnv, rotate) {
    const h = new Uint8Array(12);
    h[0] = 0x45; h[1] = 0x49; h[2] = 0x4e; h[3] = 0x4b; /* EINK */
    h[4] = 1; h[5] = rotate === 180 ? 1 : 0; h[6] = 0; h[7] = 0;
    new DataView(h.buffer).setUint32(8, fnv >>> 0, true);
    return h;
  }


  /* ---- Qual 512 / OTP 384：三 plane 族(g)/a/b，与 Python make_qual*_frames 同序。
   * 两种配方位布局完全相同，只是族索引上限 511 / 383。 ---- */
  function packQualPlanes512(ids, rotate, maxIdx) {
    if (!ids || ids.length !== W * H) throw new Error('像素数量错误');
    const lim = maxIdx === undefined ? 511 : maxIdx;
    const g = new Uint8Array(FRAME_BYTES), a = new Uint8Array(FRAME_BYTES),
      b = new Uint8Array(FRAME_BYTES);
    let off = 0;
    for (let x = W - 1; x >= 0; x--) for (let y = 0; y < H; y += 2) {
      let ia, ib;
      if (rotate === 180) { ia = (H - 1 - y) * W + (W - 1 - x); ib = (H - 2 - y) * W + (W - 1 - x); }
      else { ia = y * W + x; ib = (y + 1) * W + x; }
      const p = ids[ia], q = ids[ib];
      if (p > lim || q > lim) throw new Error((lim === 383 ? '384' : '512') + ' 色帧包含越界索引');
      g[off] = ((p >> 6) << 4) | (q >> 6);
      a[off] = (((p >> 3) & 7) << 4) | ((q >> 3) & 7);
      b[off++] = ((p & 7) << 4) | (q & 7);
    }
    return { g, a, b };
  }
  function idsFromQualPlanes512(g, a, b, rotate) {
    for (const p of [g, a, b]) if (!p || p.length !== FRAME_BYTES)
      throw new Error('三 plane 长度必须各为 172800');
    const ids = new Uint16Array(W * H);
    let off = 0;
    for (let x = W - 1; x >= 0; x--) for (let y = 0; y < H; y += 2) {
      let ia, ib;
      if (rotate === 180) { ia = (H - 1 - y) * W + (W - 1 - x); ib = (H - 2 - y) * W + (W - 1 - x); }
      else { ia = y * W + x; ib = (y + 1) * W + x; }
      ids[ia] = ((g[off] >> 4) << 6) | ((a[off] >> 4) << 3) | (b[off] >> 4);
      ids[ib] = ((g[off] & 15) << 6) | ((a[off] & 15) << 3) | (b[off] & 15);
      off++;
    }
    return ids;
  }
  function previewIds512(ids, palette) {
    const table = palette || PALETTE512;
    const out = new Uint8Array(ids.length * 4);
    for (let i = 0; i < ids.length; i++) {
      const ink = table[ids[i]];
      const rgb = ink ? ink.rgb : [255, 0, 255];
      out[i * 4] = rgb[0]; out[i * 4 + 1] = rgb[1];
      out[i * 4 + 2] = rgb[2]; out[i * 4 + 3] = 255;
    }
    return out;
  }
  function buildQualHeader512(fnv, rotate, ver) {
    const h = new Uint8Array(20);
    h[0] = 0x51; h[1] = 0x4c; h[2] = 0x34; h[3] = 0x38; /* QL48 */
    h[4] = ver || 4; h[5] = rotate === 180 ? 1 : 0; h[6] = 0; h[7] = 0;
    new DataView(h.buffer).setUint32(8, fnv[0] >>> 0, true);
    new DataView(h.buffer).setUint32(12, fnv[1] >>> 0, true);
    new DataView(h.buffer).setUint32(16, fnv[2] >>> 0, true);
    return h;
  }
  return Object.freeze({ W, H, FRAME_BYTES, CHUNK, MODES, DITHERS, ORDERED, KERNELS,
    BAYER8, BAYER16, NOISE64, COLORS, PAD_COLORS, PALETTE384, PALETTE512, PALETTE_FAST512,
    chooseOrient, rotate90, resizeRGBA, padRgbOf, applyPad, adjustRGBA,
    quantize, quantizeAsync,
    makeFrame, frameToIds, previewIds, previewIds512, fnv1a, buildHeader,
    packQualPlanes512, idsFromQualPlanes512, buildQualHeader512 });
});