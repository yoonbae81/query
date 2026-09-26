// 확장 아이콘(16/32/48/128 PNG) 생성기. 의존성 없이 zlib로 PNG를 직접 만든다.
// 실행: node scripts/make-icons.mjs  → static/icons/*.png (결과물은 저장소에 커밋한다)
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../static/icons");
mkdirSync(out, { recursive: true });

const BG = [37, 99, 235]; // 웹 UI 강조색 #2563eb
const FG = [255, 255, 255];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};

/** 단위 좌표(0~1)에서의 (배경 커버리지, 글자 커버리지). 둥근 사각형 위의 "Q" 모양 */
function sample(x, y) {
  const r = 0.22;
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
  const inBg = dx * dx + dy * dy <= r * r;
  const cx = x - 0.5, cy = y - 0.47;
  const d = Math.hypot(cx, cy);
  const ring = d <= 0.29 && d >= 0.17;
  // 우하단으로 뻗는 꼬리(Q)
  const t = (cx + cy) * Math.SQRT1_2; // 대각선 방향 좌표
  const s = (cx - cy) * Math.SQRT1_2;
  const tail = t >= 0.12 && t <= 0.34 && Math.abs(s) <= 0.055;
  return [inBg, inBg && (ring || tail)];
}

function png(size) {
  const ss = 4;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const [b, f] = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          bg += b; fg += f;
        }
      const n = ss * ss;
      const a = bg / n, f = bg ? fg / bg : 0;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(BG[i] * (1 - f) + FG[i] * f);
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) writeFileSync(resolve(out, `${size}.png`), png(size));
console.log("icons →", out);
