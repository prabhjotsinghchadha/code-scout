import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codeNearCaret,
  findCodes,
  findTypedCodes,
  formatCode,
  parseCode,
  searchUrl,
  trailerUrl,
  videoUrl,
} from './codes.ts';

const fmt = (text: string) => {
  const c = parseCode(text);
  return c && formatCode(c);
};

test('parses common code formats', () => {
  assert.equal(fmt('NSFS-484'), 'NSFS-484');
  assert.equal(fmt('nsfs-484'), 'NSFS-484');
  assert.equal(fmt('nsfs00484'), 'NSFS-484');
  assert.equal(fmt('NSFS 484'), 'NSFS-484');
  assert.equal(fmt('  [NSFS-484] Some title here '), 'NSFS-484');
  assert.equal(fmt('ipx-001'), 'IPX-001');
  assert.equal(fmt('SSIS-1023'), 'SSIS-1023');
  assert.equal(fmt('300MIUM-123'), '300MIUM-123');
});

test('parses codes from URLs', () => {
  assert.equal(fmt('https://jav.guru/123456/nsfs-484-some-title/'), 'NSFS-484');
  assert.equal(fmt('https://javtrailers.com/video/nsfs00484'), 'NSFS-484');
});

test('rejects non-codes', () => {
  assert.equal(parseCode('hello world'), null);
  assert.equal(parseCode('SHA-256'), null);
  assert.equal(parseCode('COVID-19'), null);
  assert.equal(parseCode('ABC-000'), null);
});

test('finds codes in page text', () => {
  const text = 'Watch NSFS-484 and SSIS-001 now. Uses SHA-256, not abc-123. MP-3000.';
  assert.deepEqual(
    findCodes(text).map((m) => formatCode(m.code)),
    ['NSFS-484', 'SSIS-001'],
  );
  const [first] = findCodes(text);
  assert.equal(text.slice(first.index, first.index + first.length), 'NSFS-484');
});

test('builds javtrailers URLs', () => {
  const code = parseCode('NSFS-484')!;
  assert.equal(searchUrl(code), 'https://javtrailers.com/search/nsfs-484');
  assert.equal(videoUrl(code), 'https://javtrailers.com/video/nsfs00484');
  assert.equal(trailerUrl(code, 'video'), 'https://javtrailers.com/video/nsfs00484');
  assert.equal(trailerUrl(parseCode('300MIUM-123')!, 'video'), 'https://javtrailers.com/search/300mium-123');
});

test('finds codes typed into fields', () => {
  const typed = (t: string) => findTypedCodes(t).map((m) => formatCode(m.code));
  assert.deepEqual(typed('looking for nsfs-484 trailer'), ['NSFS-484']);
  assert.deepEqual(typed('nsfs00484'), ['NSFS-484']);
  assert.deepEqual(typed('  NSFS 484 '), ['NSFS-484']);
  assert.deepEqual(typed('ssis-001, ipx-123'), ['SSIS-001', 'IPX-123']);
  assert.deepEqual(typed('hello there'), []);
  assert.deepEqual(typed('my sha-256 hash'), []);
  // Hyphen-less codes only count when they are the whole field.
  assert.deepEqual(typed('see nsfs484 later'), []);
});

test('picks the code nearest the caret', () => {
  const text = 'SSIS-001 and NSFS-484 and IPX-123';
  const at = (caret: number) => formatCode(codeNearCaret(text, caret)!);
  assert.equal(at(0), 'SSIS-001');
  assert.equal(at(15), 'NSFS-484');
  assert.equal(at(text.length), 'IPX-123');
  assert.equal(codeNearCaret('nothing here', 3), null);
});
