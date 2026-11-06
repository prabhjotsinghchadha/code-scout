import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanCueText, cueLanguage, cuesAt, decodeSubtitleFile, joinCjkSpaces, nextCueIndex, offsetText, parseSubtitles } from './srt.ts';

const SRT = `﻿1
00:00:56,940 --> 00:01:01,240
That's right, this yakisoba.

2
00:01:04,599 --> 00:01:11,080
<i>Delicious.</i>

3
00:01:19,260 --> 00:01:25,160
Eating yakisoba outside is really good.
It's really nice that it's sunny today.
`;

test('reads an .srt file', () => {
  const cues = parseSubtitles(SRT);
  assert.equal(cues.length, 3);
  assert.deepEqual(cues[0], { start: 56.94, end: 61.24, text: 'That\'s right, this yakisoba.' });
  assert.equal(cues[1].text, 'Delicious.', 'markup is taken out');
  assert.equal(cues[2].text, 'Eating yakisoba outside is really good.\nIt\'s really nice that it\'s sunny today.');
});

test('reads Windows line endings, WebVTT and short timestamps', () => {
  assert.equal(parseSubtitles(SRT.replace(/\n/g, '\r\n')).length, 3);
  const vtt = parseSubtitles('WEBVTT\n\n00:01.500 --> 00:03.000 align:start position:10%\n- Hello\n\n1:02:03.4 --> 1:02:05.0\nLater\n');
  assert.deepEqual(vtt, [
    { start: 1.5, end: 3, text: '- Hello' },
    { start: 3723.4, end: 3725, text: 'Later' },
  ]);
});

test('copes with cues that have no blank line between them, and drops empty or backwards ones', () => {
  const cues = parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\nOne\n2\n00:00:03,000 --> 00:00:04,000\nTwo\n\n3\n00:00:05,000 --> 00:00:06,000\n\n4\n00:00:08,000 --> 00:00:07,000\nBackwards\n');
  assert.deepEqual(
    cues.map((c) => c.text),
    ['One', 'Two'],
  );
});

test('reads an .ass file', () => {
  const ass = `[Script Info]
Title: test

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Comment: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,not shown
Dialogue: 0,0:00:03.00,0:00:04.50,Default,,0,0,0,,{\\an8}Second, with a comma
Dialogue: 0,0:00:01.50,0:00:02.00,Default,,0,0,0,,First\\Nline two
`;
  assert.deepEqual(parseSubtitles(ass), [
    { start: 1.5, end: 2, text: 'First\nline two' },
    { start: 3, end: 4.5, text: 'Second, with a comma' },
  ]);
});

test('cleans markup out of cue text', () => {
  assert.equal(cleanCueText('{\\an8}<font color="#ff0">Hi</font> &amp; bye&#33;'), 'Hi & bye!');
  assert.equal(cleanCueText('Line one\\NLine two'), 'Line one\nLine two');
});

test('finds the lines on screen at a time', () => {
  const cues = [
    { start: 1, end: 3, text: 'a' },
    { start: 2, end: 6, text: 'b' },
    { start: 4, end: 5, text: 'c' },
    { start: 10, end: 12, text: 'd' },
  ];
  assert.deepEqual(cuesAt(cues, 0.5), []);
  assert.deepEqual(cuesAt(cues, 1).map((c) => c.text), ['a']);
  assert.deepEqual(cuesAt(cues, 2.5).map((c) => c.text), ['a', 'b'], 'overlapping lines both show');
  assert.deepEqual(cuesAt(cues, 4.5).map((c) => c.text), ['b', 'c']);
  assert.deepEqual(cuesAt(cues, 7).map((c) => c.text), []);
  assert.deepEqual(cuesAt(cues, 11).map((c) => c.text), ['d']);
  assert.deepEqual(cuesAt([], 1), []);
  assert.equal(nextCueIndex(cues, 0), 0);
  assert.equal(nextCueIndex(cues, 5.5), 1, 'b is still up');
  assert.equal(nextCueIndex(cues, 7), 3);
  assert.equal(nextCueIndex(cues, 99), 4);
});

test('tells what language a file is in', () => {
  const english = parseSubtitles(SRT);
  assert.equal(cueLanguage(english), 'other');
  const line = (text: string) => ({ start: 0, end: 1, text });
  assert.equal(
    cueLanguage([...english, ...english, ...english, ...english, ...english, ...english, ...english, line('あ ああ')]),
    'other',
    'a line of the original left in an English file',
  );
  assert.equal(cueLanguage([line('美味しい。'), line('本当')]), 'ja');
  assert.equal(cueLanguage([line('你老公今天晚上不回来吗')]), 'zh');
  assert.equal(cueLanguage([]), 'other');
});

test('takes the spaces out from between Japanese words', () => {
  assert.equal(joinCjkSpaces('そう じゃ ん、 この 焼 き そ ば。 いただ きます。'), 'そうじゃん、この焼きそば。いただきます。');
  assert.equal(joinCjkSpaces('OK です ね'), 'OK ですね', 'spaces next to other writing stay');
});

test('reads files in UTF-8, Shift-JIS and GBK', () => {
  const text = '1\n00:00:01,000 --> 00:00:02,000\n';
  const utf8 = new TextEncoder().encode(`${text}美味しい`);
  assert.equal(decodeSubtitleFile(utf8), `${text}美味しい`);
  // 美味しい in Shift-JIS, and 你好吗 in GBK.
  const sjis = Uint8Array.from([...new TextEncoder().encode(text), 0x94, 0xfc, 0x96, 0xa1, 0x82, 0xb5, 0x82, 0xa2]);
  assert.equal(decodeSubtitleFile(sjis), `${text}美味しい`);
  const gbk = Uint8Array.from([...new TextEncoder().encode(text), 0xc4, 0xe3, 0xba, 0xc3, 0xc2, 0xf0]);
  assert.equal(decodeSubtitleFile(gbk), `${text}你好吗`);
  const utf16 = Uint8Array.from([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]);
  assert.equal(decodeSubtitleFile(utf16), 'Hi');
});

test('writes timing offsets', () => {
  assert.equal(offsetText(0), '0 s');
  assert.equal(offsetText(0.04), '0 s');
  assert.equal(offsetText(1.5), '+1.5 s');
  assert.equal(offsetText(-2), '−2 s');
});
