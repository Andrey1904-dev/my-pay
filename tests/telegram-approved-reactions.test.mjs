import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createBotHandler } from '../supabase/functions/telegram-mypay/bot.ts';
import { MAIN_KEYBOARD, money } from '../supabase/functions/_shared/mypay.ts';
import { createFakeBackend, messageUpdate, telegramRequest } from './helpers/fake-backend.mjs';

const approved = [...readFileSync(new URL('../telegram-jokes-final.md', import.meta.url), 'utf8').matchAll(/^## (UNDER_500|OVER_4000|\d+)\n\n«([^\n]+)»$/gm)];
test('all 143 approved reactions survive the actual save handler and Telegram HTML formatting', async () => {
  const user = '11111111-1111-1111-1111-111111111111';
  const backend = createFakeBackend({ tables: {
    telegram_links: [{user_id:user,chat_id:111}],
    settings: [{user_id:user,base_pay:2415,holiday_pay:4600,case_price:6.8,piece_percent:25,schedule_start:'2026-10-20'}],
  }});
  const env = { TELEGRAM_BOT_TOKEN:'123:ABC', TELEGRAM_WEBHOOK_SECRET:'s3cret', SUPABASE_URL:'https://fake.test', SUPABASE_SERVICE_ROLE_KEY:'service' };
  const bot = createBotHandler({env:k=>env[k],fetch:backend.fetch,now:()=>new Date('2026-10-25T12:00:00Z')});
  const dom = new JSDOM('');
  for (const [, key, text] of approved) {
    const count = key === 'UNDER_500' ? 499 : key === 'OVER_4000' ? 4001 : Number(key);
    for (let repeat=0; repeat<2; repeat++) {
      const before = structuredClone(backend.db.shifts || []);
      const response = await bot(telegramRequest(messageUpdate(String(count))));
      assert.equal(response.status,200);
      const payload = backend.sent().at(-1);
      const blocks = payload.text.split('\n\n');
      assert.equal(payload.parse_mode,'HTML');
      assert.equal(blocks.length,3);
      assert.equal(blocks[0], count === 499 && repeat === 0 ? '✅ Смена сохранена!' : '✅ Информация обновлена!');
      assert.equal(blocks[1],`💰 Заработано: ${money(2415 + Math.round(count * 170) / 100)}`);
      assert.equal(blocks[2],`«${text}»`);
      const parsed = new dom.window.DOMParser().parseFromString(blocks[2],'text/html');
      assert.equal(parsed.body.textContent,`«${text}»`);
      assert.equal(parsed.body.children.length,0);
      assert.deepEqual(payload.reply_markup,MAIN_KEYBOARD);
      assert.equal(backend.db.shifts.length,1);
      assert.equal(backend.db.shifts[0].cases,count);
      if (repeat) assert.deepEqual(backend.db.shifts,before);
    }
  }
  dom.window.close();
});
