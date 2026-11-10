import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSearchSource, MAX_RESULTS, parseJavGuruSearch, parseJavtrailersSearch, webSearchUrl } from './web-search.ts';

const jtCard = (id: string, code: string, title: string, date = '25 Dec 2013') =>
  `<div class="col-4"><div class="card-container"><a href="/video/${id}" class="video-link" title="${title}"><div class="card video-card">` +
  `<div class="card-img-container"><img data-src="https://images.javtrailers.com/digital/video/${id}/${id}ps.w360.webp" alt="${code} jav" class="card-img-top video-image">` +
  `<!----><span class="badge duration-badge">1:59:00</span></div><div class="card-body cb"><div class="card-text">` +
  `<p class="card-text title mb-0 vid-title">${code} ${title}</p><small class="card-text title text-muted">${date}</small></div></div></div></a></div></div>`;

test('javtrailers: a row per card, with its code, title, cover and date', () => {
  const html = `<nav><a href="/videos">New</a></nav><section class="videos-list">${jtCard('18wife00053', 'WIFE-53', '9 to 5 Married Woman Kanari Tsubaki')}${jtCard('1dldss00578', 'DLDSS-578', 'Tom &amp; Jerry', '06 Jun 2026')}</section>`;
  assert.deepEqual(parseJavtrailersSearch(html), [
    {
      url: 'https://javtrailers.com/video/18wife00053',
      title: '9 to 5 Married Woman Kanari Tsubaki',
      code: { prefix: 'wife', number: 53 },
      cover: 'https://images.javtrailers.com/digital/video/18wife00053/18wife00053ps.w360.webp',
      note: '25 Dec 2013',
    },
    {
      url: 'https://javtrailers.com/video/1dldss00578',
      title: 'Tom & Jerry',
      code: { prefix: 'dldss', number: 578 },
      cover: 'https://images.javtrailers.com/digital/video/1dldss00578/1dldss00578ps.w360.webp',
      note: '06 Jun 2026',
    },
  ]);
});

test('javtrailers: each video once, no more than the limit, nothing from a page without cards', () => {
  const many = Array.from({ length: MAX_RESULTS + 5 }, (_, i) => jtCard(`abc${String(i + 1).padStart(5, '0')}`, `ABC-${String(i + 1).padStart(3, '0')}`, `Title ${i}`));
  assert.equal(parseJavtrailersSearch(many.join('') + many[0]).length, MAX_RESULTS);
  assert.equal(parseJavtrailersSearch(jtCard('abc00001', 'ABC-001', 'One') + jtCard('abc00001', 'ABC-001', 'One')).length, 1);
  assert.deepEqual(parseJavtrailersSearch('<html><title>Just a moment...</title></html>'), []);
});

test('javtrailers: the code comes from the address when the picture has no caption', () => {
  const [row] = parseJavtrailersSearch('<a href="/video/h_237nacr00914" class="video-link"><p class="vid-title">Some title</p></a>');
  assert.deepEqual(row, { url: 'https://javtrailers.com/video/h_237nacr00914', title: 'Some title', code: { prefix: 'nacr', number: 914 } });
});

const guruCard = (path: string, title: string, img = 'https://cdn.javmiku.com/wp-content/uploads/2026/11/x-550x374.jpg') => `<div class="inside-article">
  <div class="imgg"><a href="https://jav.guru/${path}/">
    <img
      src="${img}"
      alt="${title}"
      width="550" loading="eager">
  </a></div>
  <div class="grid1"><h2>
    <a href="https://jav.guru/${path}/" title="${title}" rel="bookmark">
      ${title}                    </a>
  </h2></div>
  <div class="grid3"><p class="tags"><a href="https://jav.guru/tag/3p/" rel="tag">3P</a></p></div>
</div>`;

test('Jav Guru: a row per post; the bracketed code is taken off the title', () => {
  const html = `<main>${guruCard('1076034/vec-443-the-wife-next-door', '[VEC-443] The wife next door Azuma Rin')}${guruCard('1076292/vec-785-mr-five-years', '[VEC-785-MR] Five years after')}</main>`;
  assert.deepEqual(parseJavGuruSearch(html), [
    {
      url: 'https://jav.guru/1076034/vec-443-the-wife-next-door/',
      title: 'The wife next door Azuma Rin',
      code: { prefix: 'vec', number: 443 },
      cover: 'https://cdn.javmiku.com/wp-content/uploads/2026/11/x-550x374.jpg',
    },
    {
      url: 'https://jav.guru/1076292/vec-785-mr-five-years/',
      title: 'Five years after',
      code: { prefix: 'vec', number: 785 },
      cover: 'https://cdn.javmiku.com/wp-content/uploads/2026/11/x-550x374.jpg',
    },
  ]);
});

test('Jav Guru: a post with no code it can read keeps its whole title and has no code', () => {
  const [row] = parseJavGuruSearch(guruCard('1076305/p-2997-submissive', '[P-2997] Submissive wife, for 16 years', 'data:image/gif;base64,AAAA'));
  assert.deepEqual(row, { url: 'https://jav.guru/1076305/p-2997-submissive/', title: '[P-2997] Submissive wife, for 16 years' });
  assert.deepEqual(parseJavGuruSearch('<div class="inside-article"><a href="https://elsewhere.example/1/x/">x</a></div>'), []);
});

test('search addresses, and which sources there are', () => {
  assert.equal(webSearchUrl('javtrailers', ' Miu Aona '), 'https://javtrailers.com/search/miu%20aona');
  assert.equal(webSearchUrl('javguru', ' cheating wife '), 'https://jav.guru/?s=cheating%20wife');
  assert.equal(isSearchSource('javguru'), true);
  assert.equal(isSearchSource('elsewhere'), false);
});
