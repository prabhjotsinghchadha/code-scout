import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  downloadProblem,
  fileName,
  findPlaylistLinks,
  isMasterPlaylist,
  isPlaylist,
  parseAttributes,
  parseMasterPlaylist,
  parseMediaPlaylist,
  pickVariant,
} from './hls-playlist.ts';

// Shaped like 18JAV's playlists: relative segment names next to the playlist, a token in the path.
const BASE = 'https://s7.example-cdn.com/hls/TOKEN/1793889224/storage/PMX046/f7e5.m3u8';
const MEDIA = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-ALLOW-CACHE:YES
#EXT-X-TARGETDURATION:6
#EXTINF:4.270933,
f7e5000.ts
#EXTINF:4.604600,
f7e5001.ts
#EXTINF:3.5,
/other/f7e5002.ts?x=1
#EXT-X-ENDLIST
`;

test('parses a media playlist into absolute segment URLs and durations', () => {
  assert.equal(isPlaylist(MEDIA), true);
  assert.equal(isMasterPlaylist(MEDIA), false);
  const p = parseMediaPlaylist(MEDIA, BASE);
  assert.deepEqual(p.segments, [
    'https://s7.example-cdn.com/hls/TOKEN/1793889224/storage/PMX046/f7e5000.ts',
    'https://s7.example-cdn.com/hls/TOKEN/1793889224/storage/PMX046/f7e5001.ts',
    'https://s7.example-cdn.com/other/f7e5002.ts?x=1',
  ]);
  assert.deepEqual(p.durations, [4.270933, 4.6046, 3.5]);
  assert.equal(p.ended, true);
  assert.equal(p.encrypted, false);
  assert.equal(downloadProblem(p), null);
});

test('flags playlists the downloader cannot save', () => {
  const live = parseMediaPlaylist(MEDIA.replace('#EXT-X-ENDLIST', ''), BASE);
  assert.match(downloadProblem(live) ?? '', /live/);
  const encrypted = parseMediaPlaylist(MEDIA.replace('#EXT-X-VERSION:3', '#EXT-X-KEY:METHOD=AES-128,URI="k"'), BASE);
  assert.match(downloadProblem(encrypted) ?? '', /encrypted/);
  const none = parseMediaPlaylist(MEDIA.replace('#EXT-X-VERSION:3', '#EXT-X-KEY:METHOD=NONE'), BASE);
  assert.equal(none.encrypted, false);
  const fmp4 = parseMediaPlaylist(MEDIA.replace('#EXT-X-VERSION:3', '#EXT-X-MAP:URI="init.mp4"'), BASE);
  assert.ok(downloadProblem(fmp4));
  assert.ok(downloadProblem(parseMediaPlaylist('#EXTM3U\n#EXT-X-ENDLIST', BASE)));
});

test('parses master playlists and picks the variant to download', () => {
  const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
360/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720
720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=842x480
480/index.m3u8
`;
  assert.equal(isMasterPlaylist(master), true);
  const variants = parseMasterPlaylist(master, 'https://cdn.example.com/v/master.m3u8');
  assert.equal(variants.length, 3);
  assert.deepEqual(variants[0], { url: 'https://cdn.example.com/v/360/index.m3u8', bandwidth: 800000, width: 640, height: 360 });
  assert.equal(pickVariant(variants)?.height, 720);
  assert.equal(pickVariant(variants, 'https://cdn.example.com/v/480/index.m3u8')?.height, 480);
  assert.equal(pickVariant([]), undefined);
});

test('reads attribute lists with quoted commas', () => {
  assert.deepEqual(parseAttributes('BANDWIDTH=1,CODECS="a,b",RESOLUTION=1x2'), {
    BANDWIDTH: '1',
    CODECS: 'a,b',
    RESOLUTION: '1x2',
  });
});

test('finds a fresh link to the same playlist in a page', () => {
  const html = `<script>
    var hlsUrl = "https://s7.example-cdn.com/hls/NEWTOKEN/1793890901/storage/PMX046/f7e5.m3u8";
    var other = "https://s7.example-cdn.com/hls/X/1/storage/ABC/zzz.m3u8";
    var escaped = "https:\\/\\/s8.example-cdn.com\\/hls\\/T2\\/1\\/storage\\/PMX046\\/f7e5.m3u8";
  </script>`;
  assert.deepEqual(findPlaylistLinks(html, BASE), [
    'https://s7.example-cdn.com/hls/NEWTOKEN/1793890901/storage/PMX046/f7e5.m3u8',
    'https://s8.example-cdn.com/hls/T2/1/storage/PMX046/f7e5.m3u8',
  ]);
  assert.deepEqual(findPlaylistLinks(`"${BASE}"`, BASE), []); // the same expired link doesn't count
  assert.equal(fileName(BASE), 'f7e5.m3u8');
  assert.equal(fileName('not a url'), '');
});
