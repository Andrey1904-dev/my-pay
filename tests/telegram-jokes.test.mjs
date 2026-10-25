import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { THRESHOLD_JOKES, BELOW_500_JOKE, ABOVE_4000_JOKE, selectJoke, validateJokeRegistry } from '../supabase/functions/_shared/telegram-jokes.ts';

test('exactly 141 distinct complete thresholds and 143 distinct reactions', () => {
  validateJokeRegistry();
  assert.equal(Object.keys(THRESHOLD_JOKES).length,141);
  assert.equal(new Set(Object.values(THRESHOLD_JOKES)).size,141);
  assert.equal(new Set([...Object.values(THRESHOLD_JOKES),BELOW_500_JOKE,ABOVE_4000_JOKE]).size,143);
});
for (let threshold=500; threshold<=4000; threshold+=25) {
  test(`threshold ${threshold}: every integer rounds down correctly`, () => {
    for (let count=threshold;count<=Math.min(threshold+24,4000);count++) assert.equal(selectJoke(count),THRESHOLD_JOKES[threshold]);
  });
}
test('explicit boundaries and specials', () => {
  for (const [n,t] of [[499,null],[500,500],[524,500],[525,525],[599,575],[600,600],[825,825],[999,975],[1000,1000],[1250,1250],[1399,1375],[1999,1975],[2000,2000],[2999,2975],[3000,3000],[3999,3975],[4000,4000],[4001,null]]) {
    assert.equal(selectJoke(n),t?THRESHOLD_JOKES[t]:n<500?BELOW_500_JOKE:ABOVE_4000_JOKE);
  }
  assert.equal(selectJoke(0),BELOW_500_JOKE);
  assert.equal(selectJoke(20000),ABOVE_4000_JOKE);
  for (const invalid of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>selectJoke(invalid),RangeError);
});

const approved = [...readFileSync(new URL('../telegram-jokes-final.md', import.meta.url), 'utf8').matchAll(/^## (UNDER_500|OVER_4000|\d+)\n\n«([^\n]+)»$/gm)].map(([, key, text]) => [key, text]);
test('all 143 exact approved texts and their threshold mapping are pinned', () => {
  assert.equal(approved.length, 143);
  assert.equal(createHash('sha256').update(approved.map(([, text]) => text).join('\n')).digest('hex'), 'eaf8440bcb849ed0759b7bea21b7c5fa93f49312e653bb4e2a26e3517187e7b6');
  assert.deepEqual(approved.map(([key]) => key), ['UNDER_500', ...Array.from({length: 141}, (_, i) => String(500 + i * 25)), 'OVER_4000']);
  for (const [key, text] of approved) {
    assert.equal(selectJoke(key === 'UNDER_500' ? 499 : key === 'OVER_4000' ? 4001 : Number(key)), text, key);
  }
});
