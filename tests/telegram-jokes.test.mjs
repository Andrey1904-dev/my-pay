import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  for (const [n,t] of [[499,null],[500,500],[524,500],[525,525],[999,975],[1000,1000],[3999,3975],[4000,4000],[4001,null]]) {
    assert.equal(selectJoke(n),t?THRESHOLD_JOKES[t]:n<500?BELOW_500_JOKE:ABOVE_4000_JOKE);
  }
  assert.equal(selectJoke(0),BELOW_500_JOKE);
  assert.equal(selectJoke(20000),ABOVE_4000_JOKE);
  for (const invalid of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>selectJoke(invalid),RangeError);
});
