import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCode, type VideoCode } from './codes.ts';
import { bestFile, parseSubtitleCatPage, parseSubtitleCatSearch, subtitleCatSearchUrl, titleHasCode } from './subtitle-cat.ts';

const code = (text: string) => parseCode(text) as VideoCode;

// Rows as SubtitleCat's search page writes them (trimmed).
const row = (href: string, title: string, from: string, good: boolean, size: string, downloads: number) => `
	<tr>
		<td><a href="${href}">${title}</a> (translated from ${from})</td>
		<td class="sub-table__stars">${good ? '<span title="Rated good by users">👍</span>' : '&nbsp;'}</td>
		<td class="sub-table__metric"><span class="sub-table__metric-label"><img src="assets/images/disk.png" alt=""> Size</span><span class="sub-table__metric-value">${size}</span></td>
		<td class="sub-table__metric"><span class="sub-table__metric-label"><img src="assets/images/arrow-down.png" alt=""> Downloads</span><span class="sub-table__metric-value">${downloads}<span class="sub-table__metric-unit"> downloads</span></span></td>
		<td class="sub-table__metric"><span class="sub-table__metric-label"><img src="assets/images/lang.png" alt=""> Languages</span><span class="sub-table__metric-value">33<span class="sub-table__metric-unit"> languages</span></span></td>
	</tr>`;

const SEARCH = `<table class="table sub-table"><thead><tr><th colspan="2"><h2 class="sec-title">4 subtitles found</h2></th></tr></thead><tbody>
${row('subs/1557/NSFS-484-javgg.net-ja.html', 'NSFS-484-javgg.net-ja', 'Japanese', false, '42 KB', 19)}
${row('subs/1534/NSFS-484-javgg.net.html', 'NSFS-484-javgg.net', 'Japanese', true, '42 KB', 33)}
${row('subs/1557/%5BNSFS-484-SUBS%5D%202%20notti.html', '[NSFS-484-SUBS] 2 notti', 'English', false, '207 B', 24)}
${row('subs/99/NSFS-4840.html', 'NSFS-4840', 'Japanese', false, '40 KB', 99)}
${row('subs/12/nsfs00484%20eng.html', 'nsfs00484 eng', 'English', false, '1.2 MB', 5)}
</tbody></table>`;

test('builds the search address', () => {
  assert.equal(subtitleCatSearchUrl(code('nsfs00484')), 'https://www.subtitlecat.com/index.php?search=NSFS-484');
});

test('matches file names to codes', () => {
  assert.equal(titleHasCode('NSFS-484-javgg.net', code('NSFS-484')), true);
  assert.equal(titleHasCode('[nsfs00484] title', code('NSFS-484')), true);
  assert.equal(titleHasCode('SSIS_001 eng', code('SSIS-001')), true);
  assert.equal(titleHasCode('NSFS-4840', code('NSFS-484')), false);
  assert.equal(titleHasCode('XNSFS-484', code('NSFS-484')), false);
  assert.equal(titleHasCode('MIUM-123 subs', code('300MIUM-123')), true);
});

test('lists the files a search finds for the code, best first', () => {
  const found = parseSubtitleCatSearch(SEARCH, code('NSFS-484'));
  assert.deepEqual(
    found.map((f) => [f.title, f.from, f.good, f.downloads, f.bytes]),
    [
      ['NSFS-484-javgg.net', 'Japanese', true, 33, 42e3],
      ['NSFS-484-javgg.net-ja', 'Japanese', false, 19, 42e3],
      ['nsfs00484 eng', 'English', false, 5, 1.2e6],
    ],
    'rated good first, then by downloads; the 207-byte file and NSFS-4840 are left out',
  );
  assert.equal(found[0].pageUrl, 'https://www.subtitlecat.com/subs/1534/NSFS-484-javgg.net.html');
  assert.equal(found[2].pageUrl, 'https://www.subtitlecat.com/subs/12/nsfs00484%20eng.html');
  assert.deepEqual(parseSubtitleCatSearch('<html>no results</html>', code('NSFS-484')), []);
});

const PAGE_URL = 'https://www.subtitlecat.com/subs/1534/NSFS-484-javgg.net.html';
const download = (lang: string, href: string) =>
  `<span><a id="download_${lang}"  onclick="log_download(1); show_voting('${lang}');" href="${href}" class="green-link">Download</a></span>`;
const translate = (lang: string, file: string) =>
  `<span><button id="${lang}" onclick="translate_from_server_folder('${lang}', '${file}', '/subs/1534/')" class="yellow-link">Translate</button></span>`;

test('finds the English and original files on a subtitle page', () => {
  const html = [
    translate('af', 'NSFS-484-javgg.net-orig.srt'),
    download('zh-CN', '/subs/1534/NSFS-484-javgg.net-zh-CN.srt'),
    download('en', '/subs/1534/NSFS-484-javgg.net-en.srt'),
  ].join('\n');
  assert.deepEqual(parseSubtitleCatPage(html, PAGE_URL), {
    english: 'https://www.subtitlecat.com/subs/1534/NSFS-484-javgg.net-en.srt',
    original: 'https://www.subtitlecat.com/subs/1534/NSFS-484-javgg.net-orig.srt',
    chinese: 'https://www.subtitlecat.com/subs/1534/NSFS-484-javgg.net-zh-CN.srt',
    japanese: undefined,
  });
  const spaced = parseSubtitleCatPage(translate('af', 'SSIS-001 eng-orig.srt'), PAGE_URL);
  assert.equal(spaced.original, 'https://www.subtitlecat.com/subs/1534/SSIS-001%20eng-orig.srt');
});

test('picks the file to show', () => {
  const files = { english: 'en.srt', original: 'orig.srt', chinese: 'zh.srt', japanese: 'ja.srt' };
  assert.equal(bestFile(files, 'Japanese'), 'en.srt');
  assert.equal(bestFile({ ...files, english: undefined }, 'Japanese'), 'orig.srt');
  assert.equal(bestFile({ ...files, english: undefined }, 'Korean'), 'zh.srt', 'Korean can’t be translated here: a Chinese translation can');
  assert.equal(bestFile({ original: 'orig.srt' }, 'Korean'), undefined);
});
