import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillTemplate, isWebUrl, siteNameFromTemplate, validateTemplate } from './open-on.ts';

const nsfs = { prefix: 'nsfs', number: 484 };
const ipx = { prefix: 'ipx', number: 1 };

test('fills placeholders', () => {
  assert.equal(fillTemplate('https://missav.ws/en/{code_lower}', nsfs), 'https://missav.ws/en/nsfs-484');
  assert.equal(
    fillTemplate('https://www.javlibrary.com/en/vl_searchbyid.php?keyword={code}', nsfs),
    'https://www.javlibrary.com/en/vl_searchbyid.php?keyword=NSFS-484',
  );
  assert.equal(fillTemplate('https://www.javmost.ws/{code}/', ipx), 'https://www.javmost.ws/IPX-001/');
  assert.equal(fillTemplate('https://x.example/v/{id}?q={code}', nsfs), 'https://x.example/v/nsfs00484?q=NSFS-484');
});

test('validates templates', () => {
  assert.equal(validateTemplate('https://jav.guru/?s={code}'), null);
  assert.equal(validateTemplate('https://jav.guru/?s={code}'), null); // regex state doesn't leak between calls
  assert.match(validateTemplate('')!, /Enter/);
  assert.match(validateTemplate('https://jav.guru/')!, /Include/);
  assert.match(validateTemplate('javascript:alert({code})')!, /http/);
  assert.match(validateTemplate('jav.guru/?s={code}')!, /valid URL/);
});

test('derives names and checks URLs', () => {
  assert.equal(siteNameFromTemplate('https://www.javmost.ws/{code}/'), 'javmost.ws');
  assert.equal(isWebUrl('https://missav.ws/en/nsfs-484'), true);
  assert.equal(isWebUrl('chrome://settings'), false);
  assert.equal(isWebUrl('nonsense'), false);
});
