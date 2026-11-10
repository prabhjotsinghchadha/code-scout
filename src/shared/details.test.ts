import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDetails, detailsFrom, detailsLine, englishName, htmlText, mergeDetails, parseDetails, type VideoDetails } from './details.ts';

// The shape of a javtrailers video page (server HTML), cut down to what's read; the names are made up.
const PAGE = `<!doctype html><html><head>
<meta property="og:title" content="ABCD-123 Jav streaming Online">
<meta property="og:image" content="https://images.javtrailers.com/digital/video/abcd00123/abcd00123pl.webp">
</head><body>
<a href="/casts/someone-else">Someone Else</a><a href="/studios/other-studio">Other Studio</a>
<h1 class="lead">ABCD-123 A weekend at the lake &amp; what happened &#39;after&#39;</h1>
<p class="mb-1"><span class="font-weight-bold mr-3">DVD ID:</span> ABCD-123</p>
<p class="mb-1"><span class="font-weight-bold mr-3">Content ID:</span> abcd00123</p>
<p class="mb-1"><span class="font-weight-bold mr-3">Release Date:</span> 06 Jun 2026</p>
<p class="mb-1"><span class="font-weight-bold mr-3">Duration:</span> 136 mins</p>
<p class="mb-1"><span class="font-weight-bold mr-3">Director:</span> A Director</p>
<p class="mb-1"><span class="font-weight-bold mr-3">Studio:</span><a href="/studios/lake-films" class="badge badge-link">Lake Films</a></p>
<p class="mb-1"><span class="font-weight-bold mr-3">Categories:</span><!--[--><a href="/categories/hi-def" class="badge">Hi-Def</a><a href="/categories/drama" class="badge">Drama</a><!--]--></p>
<p class="mb-1"><span class="font-weight-bold mr-3">Cast(s):</span><!--[--><a href="/casts/hana-mori-1" class="badge mr-2">Hana Mori 森はな</a><a href="/casts/yui-sato" class="badge mr-2">Yui Sato</a><!--]--></p>
<p class="mb-1 mt-2 series-container"><span class="font-weight-bold mr-3">Series:</span><a href="/series/lake-weekend" class="badge">Lake Weekend</a></p>
</body></html>`;
const URL_ = 'https://javtrailers.com/video/abcd00123';

test('a video page: title without the code, cover, cast, studio, series, genres, date, length', () => {
  assert.deepEqual(parseDetails(PAGE, URL_, 5), {
    title: "A weekend at the lake & what happened 'after'",
    cast: [
      { name: 'Hana Mori 森はな', url: 'https://javtrailers.com/casts/hana-mori-1' },
      { name: 'Yui Sato', url: 'https://javtrailers.com/casts/yui-sato' },
    ],
    genres: [
      { name: 'Hi-Def', url: 'https://javtrailers.com/categories/hi-def' },
      { name: 'Drama', url: 'https://javtrailers.com/categories/drama' },
    ],
    url: URL_,
    at: 5,
    cover: 'https://images.javtrailers.com/digital/video/abcd00123/abcd00123pl.webp',
    studio: { name: 'Lake Films', url: 'https://javtrailers.com/studios/lake-films' },
    series: { name: 'Lake Weekend', url: 'https://javtrailers.com/series/lake-weekend' },
    released: '06 Jun 2026',
    minutes: 136,
  });
});

test('only the labelled parts count: links elsewhere on the page are not the cast', () => {
  const d = parseDetails(PAGE, URL_, 0)!;
  assert.ok(!d.cast.some((c) => c.name === 'Someone Else'));
  assert.equal(d.studio?.name, 'Lake Films');
});

test('a page with no cast or studio listed still has its title; a page that is no video page has nothing', () => {
  const bare = '<h1>ABCD-123 Just a title</h1><p class="mb-1"><span>DVD ID:</span> ABCD-123</p>';
  assert.deepEqual(parseDetails(bare, URL_, 1), { title: 'Just a title', cast: [], genres: [], url: URL_, at: 1 });
  assert.equal(parseDetails('<h1>Search results</h1><p>nothing</p>', URL_, 1), null);
  assert.equal(parseDetails('', URL_, 1), null);
});

test('text from HTML, and the English part of a name', () => {
  assert.equal(htmlText('<b>A&amp;B</b> <!-- x --> &#x41;&#66; &quot;c&quot; &bogus;'), 'A&B AB "c" &bogus;');
  assert.equal(englishName('Miu Aona 碧那美海'), 'Miu Aona');
  assert.equal(englishName('Yui Sato'), 'Yui Sato');
  assert.equal(englishName('森はな'), '森はな');
});

const d = (title: string, at: number, more: Partial<VideoDetails> = {}): VideoDetails => ({ title, cast: [], genres: [], url: URL_, at, ...more });

test('stored details are checked: a code as its own key, a title, web addresses only', () => {
  const cache = detailsFrom({
    'ABCD-123': { ...d('Fine', 3), cover: 'javascript:alert(1)', studio: { name: 'S', url: 'https://javtrailers.com/studios/s' }, cast: [{ name: 'A', url: 'http://x' }, 'nope'] },
    'abcd123': d('Key is not the code as written', 1),
    'EFGH-456': { title: '', url: URL_ },
    'IJKL-789': { title: 'No address' },
    nonsense: 4,
  });
  assert.deepEqual(Object.keys(cache), ['ABCD-123']);
  assert.equal(cache['ABCD-123'].cover, undefined);
  assert.deepEqual(cache['ABCD-123'].cast, []);
  assert.equal(cache['ABCD-123'].studio?.name, 'S');
  assert.deepEqual(detailsFrom(null), {});
  assert.deepEqual(detailsFrom([1]), {});
});

test('the cache keeps the most recently read', () => {
  let cache = {};
  cache = addDetails(cache, { prefix: 'aaa', number: 1 }, d('one', 1), 2);
  cache = addDetails(cache, { prefix: 'bbb', number: 2 }, d('two', 2), 2);
  cache = addDetails(cache, { prefix: 'ccc', number: 3 }, d('three', 3), 2);
  assert.deepEqual(Object.keys(cache).sort(), ['BBB-002', 'CCC-003']);
  const merged = mergeDetails({ 'AAA-001': d('old', 1), 'BBB-002': d('here', 9) }, { 'AAA-001': d('newer', 5), 'BBB-002': d('file', 2) });
  assert.equal(merged['AAA-001'].title, 'newer');
  assert.equal(merged['BBB-002'].title, 'here');
});

test('the line under a code: performers (two, then +n) and the studio', () => {
  const cast = ['Hana Mori 森はな', 'Yui Sato', 'Third One'].map((name) => ({ name, url: URL_ }));
  assert.equal(detailsLine(d('t', 0, { cast, studio: { name: 'Lake Films', url: URL_ } })), 'Hana Mori, Yui Sato +1 · Lake Films');
  assert.equal(detailsLine(d('t', 0, { cast: cast.slice(0, 1) })), 'Hana Mori');
  assert.equal(detailsLine(d('t', 0)), '');
});
