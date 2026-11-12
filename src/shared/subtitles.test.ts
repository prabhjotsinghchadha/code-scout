import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cjkCount,
  hasKana,
  isEmptyMask,
  LruCache,
  maskCount,
  maskDensity,
  maskDifference,
  maskRegion,
  normalizeLine,
  pictureRect,
  preferOutlined,
  stripBoxToScreen,
  subtitleLanguage,
  subtitleLines,
  subtitleLookVars,
  textMask,
  unionBox,
  WatermarkTracker,
  type OcrLine,
} from './subtitles.ts';

test('tells Japanese from Chinese lines', () => {
  assert.equal(hasKana('今日は早く帰ってきてね'), true);
  assert.equal(hasKana('你老公今天晚上不回来吗'), false);
  assert.equal(subtitleLanguage('你老公今天晚上不回来吗？', false), 'zh');
  assert.equal(subtitleLanguage('お義父さん、やめてください', false), 'ja');
  assert.equal(subtitleLanguage('本当', true), 'ja', 'a kanji-only line in a Japanese video stays Japanese');
  assert.equal(cjkCount('18JAV.TV 麻豆'), 2);
  assert.equal(normalizeLine('别这样 ……会被人看到的！'), '别这样会被人看到的');
});

// Positions as OCR reported them on a 1280-wide test strip, scaled to the 960-wide strip.
const line = (text: string, x: number, width: number, score = 0.99): OcrLine => ({
  text,
  box: { x, y: 60, width, height: 36 },
  score,
});

test('keeps centred subtitle lines and drops watermarks, noise and unsure reads', () => {
  const lines = [
    line('你在想什么呢？快点过来', 294, 364),
    line('18JAV.TV麻豆传媒', 787, 161), // top-right watermark
    line('2', 171, 85), // background noise
    line('通', 213, 16),
    line('今日法早<帰吖吉乙', 300, 300, 0.4), // garbled
  ];
  assert.deepEqual(
    subtitleLines(lines, 960).map((l) => l.text),
    ['你在想什么呢？快点过来'],
  );
});

test('places strip boxes on screen, allowing for letterboxing', () => {
  // A 16:9 video in a 4:3 element gets bars above and below.
  const picture = pictureRect({ x: 0, y: 0, width: 800, height: 600 }, 1280, 720);
  assert.deepEqual(picture, { x: 0, y: 75, width: 800, height: 450 });
  assert.deepEqual(pictureRect({ x: 10, y: 20, width: 300, height: 200 }, 0, 0), { x: 10, y: 20, width: 300, height: 200 });
  // Strip: bottom 30% of the picture (135px on screen), read at 960 × 162.
  const screen = stripBoxToScreen({ x: 480, y: 81, width: 96, height: 16.2 }, picture, 960, 162);
  assert.equal(screen.x, 400);
  assert.equal(screen.y, 75 + 315 + 67.5);
  assert.equal(screen.width, 80);
  assert.equal(Math.round(screen.height * 100) / 100, 13.5);
  assert.deepEqual(unionBox([{ x: 10, y: 10, width: 10, height: 10 }, { x: 0, y: 15, width: 5, height: 20 }]), {
    x: 0,
    y: 10,
    width: 20,
    height: 25,
  });
  assert.equal(unionBox([]), null);
});

/** A grey strip, optionally with a white bar outlined in black (like a subtitle stroke). */
function strip(width: number, height: number, bar?: { x: number; w: number }) {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let v = 120;
      if (bar && x >= bar.x - 2 && x < bar.x + bar.w + 2 && y >= 18 && y < 32) v = 0; // outline
      if (bar && x >= bar.x && x < bar.x + bar.w && y >= 20 && y < 30) v = 255; // text
      px.set([v, v, v, 255], i);
    }
  }
  return px;
}

test('finds outlined text pixels and notices when the line changes', () => {
  const w = 200;
  const h = 50;
  const none = textMask(strip(w, h), w, h);
  const a = textMask(strip(w, h, { x: 40, w: 60 }), w, h);
  const same = textMask(strip(w, h, { x: 40, w: 60 }), w, h);
  const b = textMask(strip(w, h, { x: 110, w: 60 }), w, h);
  assert.equal(isEmptyMask(none), true);
  assert.equal(isEmptyMask(a), false);
  assert.equal(maskDifference(a, same), 0);
  assert.ok(maskDifference(a, b) > 0.5);
  // A plain bright area without an outline (a white wall) isn't text.
  const wall = new Uint8ClampedArray(w * h * 4).fill(255);
  assert.equal(isEmptyMask(textMask(wall, w, h)), true);
  // Nor is an outlined bright shape at the very edge of the frame (where subtitles never are).
  assert.equal(isEmptyMask(textMask(strip(w, h, { x: 2, w: 20 }), w, h)), true);
});

test('finds text with a soft grey shadow on a bright scene, but not the scene itself', () => {
  // White letters (245) with a grey shadow to the right and below (130), on a white dress (215): no black
  // outline anywhere. Measured on 18JAV's MD0302, whose subtitles were never read.
  const w = 200;
  const h = 50;
  const scene = (text: boolean) => {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 215 + (x % 40 < 20 ? 0 : 25); // folds of the dress: bright, 25 apart
        const stroke = (sx: number, sy: number) => sx >= 40 && sx < 160 && sy >= 20 && sy < 30 && sx % 8 < 3;
        if (text && stroke(x - 1, y - 1)) v = 130; // shadow
        if (text && stroke(x, y)) v = 245;
        px.set([v, v, v, 255], (y * w + x) * 4);
      }
    }
    return px;
  };
  assert.equal(isEmptyMask(textMask(scene(true), w, h)), false);
  assert.equal(maskCount(textMask(scene(false), w, h)), 0);
});

test('follows one line by the text pixels inside its box', () => {
  const w = 200;
  const h = 50;
  const box = { x: 40, y: 20, width: 60, height: 10 };
  const shown = maskRegion(textMask(strip(w, h, { x: 40, w: 60 }), w, h), w, box);
  // Something else changes outside the box: same line.
  const elsewhere = strip(w, h, { x: 40, w: 60 });
  for (let x = 120; x < 160; x++) for (let y = 5; y < 15; y++) elsewhere.set([x % 4 ? 255 : 0, 255, 255, 255], (y * w + x) * 4);
  assert.equal(maskDifference(maskRegion(textMask(elsewhere, w, h), w, box), shown), 0);
  // The line is gone: nothing left in its box.
  assert.equal(maskCount(maskRegion(textMask(strip(w, h), w, h), w, box)), 0);
  // A different line in the same place: the box's pixels change.
  assert.ok(maskDifference(maskRegion(textMask(strip(w, h, { x: 70, w: 60 }), w, h), w, box), shown) > 0.3);
});

test('flags text that stays on screen as a watermark', () => {
  const t = new WatermarkTracker(20);
  t.update(['麻豆传媒', '你好吗'], 0);
  t.update(['麻豆传媒', '我很好'], 5);
  t.update(['麻豆传媒', '谢谢'], 25);
  assert.equal(t.isWatermark('麻豆传媒', 25), true);
  assert.equal(t.isWatermark('谢谢', 25), false);
  t.update(['你好吗'], 30); // gone and back: counts from now
  assert.equal(t.isWatermark('你好吗', 30), false);
});

test('LRU cache evicts the least recently used entry', () => {
  const c = new LruCache<string, string>(2);
  c.set('a', '1');
  c.set('b', '2');
  c.get('a');
  c.set('c', '3');
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('a'), '1');
  assert.equal(c.size, 2);
});

test('subtitle look: box opacity, and an outline once the box is see-through', () => {
  assert.deepEqual(subtitleLookVars(100), { '--javtr-sub-bg': '1', '--javtr-sub-shadow': 'none' });
  assert.equal(subtitleLookVars(60)['--javtr-sub-shadow'], 'none');
  assert.equal(subtitleLookVars(50)['--javtr-sub-bg'], '0.5');
  assert.notEqual(subtitleLookVars(50)['--javtr-sub-shadow'], 'none');
  assert.equal(subtitleLookVars(-20)['--javtr-sub-bg'], '0');
  assert.equal(subtitleLookVars(250)['--javtr-sub-bg'], '1');
});

test('prefers outlined subtitle text over other text the OCR read', () => {
  // A 100×40 strip (mask cells of 2 px): outlined text in the lower half, nothing in the upper half.
  const width = 100;
  const mask = new Uint8Array(50 * 20);
  for (let r = 12; r < 18; r++) for (let c = 10; c < 40; c += 3) mask[r * 50 + c] = 1;
  const subtitle = { text: '我叫你给我拿回去重做', box: { x: 20, y: 24, width: 60, height: 12 } };
  const sign = { text: '开元棋牌', box: { x: 30, y: 2, width: 30, height: 12 } };
  assert.ok(maskDensity(mask, width, subtitle.box) > 0.05);
  assert.equal(maskDensity(mask, width, sign.box), 0);
  assert.deepEqual(preferOutlined([sign, subtitle], mask, width), [subtitle]);
  // No outlined text at all (a style the mask misses): keep what the OCR found.
  assert.deepEqual(preferOutlined([sign], new Uint8Array(50 * 20), width), [sign]);
});
