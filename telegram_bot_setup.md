# CASE.PLACE SALARY — Telegram-бот

Бот живёт в Supabase Edge Functions и работает с теми же таблицами, что и приложение: смена, внесённая из чата, сразу видна на сайте, и наоборот.

## Что умеет

Интерфейс v18: каждый ответ — **карточка с inline-кнопками**, которые редактируют то же сообщение (чат не засоряется), плюс постоянная клавиатура с самым частым.

**Чехлы**
- Ввод за сегодня: `350`, `350 + 500`, `чехлы 350`, `упаковал 1200 чехлов`. Если смена уже внесена, бот спрашивает: «➕ Добавить» или «✏️ Заменить» (кнопки действуют 15 минут).
- Добавить к текущему: `+500` или кнопки `+100 / +500 / +1000` — в клавиатуре и под карточкой смены.
- За другой день: `вчера 900`, `позавчера +100`, `27.09 900`, `05.09.2026 1200`.
- Карточка смены: чехлы, мотивация, заработок (ставка + сделка в цитате), время до конца смены (08:00–19:00 Екатеринбург) и темп — сколько чехлов и денег получится к 19:00 при текущей скорости. Кнопки: +100/+500/+1000, ↩️ Отменить, 🎉 Праздничная, 📊 Месяц, 🔮 Прогноз, 📅 Календарь.

**Отчёты**
- `/today` («📦 Сегодня») — карточка дня и статус по графику.
- `/month` («📊 Месяц») — заработано, смены, чехлы, средняя и лучшая смена, прогноз.
- `/forecast` («🔮 Прогноз») — сколько смен осталось по графику 2/2, прогноз, что завтра.
- `/calendar` («📅 Календарь») — моноширинная сетка месяца: ▪ смена внесена, · рабочий по графику, ▸ сегодня; итог месяца и кнопки ◀️ / ▶️ по месяцам.
- `/last` — последняя внесённая смена.

**Управление**
- `/settings` («⚙️ Ещё») — ставки и график; кнопки «🔔/🔕 напоминания» и «🕘 Время: 21:00» (по кругу 19 → 20 → 21 → 22).
- `/undo` — откатить последнее добавление за сегодня (только сделанные через бота); `/holiday` — переключить праздничную ставку.
- `/notify_on`, `/notify_off`, `/menu` (вернуть клавиатуру), `/help`, `/unlink`.
- При `/start` бот сам выставляет список команд для меню «/» (`setMyCommands`).
- Все входящие и исходящие сообщения журналируются в `telegram_bot_events`.

Расчёт берётся из таблицы `settings` пользователя (ставка, праздничная ставка, цена чехла, процент сделки, начало графика).

## Файлы

```text
supabase/functions/_shared/mypay.ts          общая логика (модель оплаты, график, PostgREST, Telegram API)
supabase/functions/telegram-mypay/index.ts   вход Deno (Deno.serve)
supabase/functions/telegram-mypay/bot.ts     обработчик вебхука
supabase/functions/telegram-reminders/       функция напоминаний
tests/telegram-bot.test.mjs                  проверки на моках
```

## Установка

1. Создай бота через `@BotFather` → `/newbot`, сохрани токен.
2. Выполни `TELEGRAM_SUPABASE.sql` в Supabase SQL Editor (после `SUPABASE_SCHEMA.sql`).
3. Установи Supabase CLI, войди и привяжи проект:
   ```bash
   supabase login
   supabase link --project-ref PROJECT_REF
   ```
4. Добавь секреты (URL и service-role-ключ Supabase подставляет в функции сам):
   ```bash
   supabase secrets set TELEGRAM_BOT_TOKEN=123456:ABC... TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 24)
   ```
5. Задеплой функции без проверки JWT (Telegram не присылает JWT, защита — secret token):
   ```bash
   supabase functions deploy telegram-mypay --no-verify-jwt
   supabase functions deploy telegram-reminders --no-verify-jwt
   ```
6. Установи webhook **обязательно с `secret_token`** — функция отвечает 401 без него:
   ```text
   https://api.telegram.org/botТОКЕН/setWebhook?url=https://PROJECT_REF.supabase.co/functions/v1/telegram-mypay&secret_token=СЕКРЕТ&drop_pending_updates=true
   ```
   Проверка: `https://api.telegram.org/botТОКЕН/getWebhookInfo` — поле `last_error_message` должно быть пустым.
7. В приложении: **Ещё → Telegram-бот → Получить код** (нужен вход в аккаунт). Команда `/start КОД` копируется в буфер — отправь её боту. Код действует ограниченное время и одноразовый.

## Обновление действующего production

24 октября 2026 обновлён проект `dyixwxxpjmyycgigcbtx`: повторно применена Telegram-схема,
исправлены права RPC выдачи кода и семь значений по умолчанию в `settings`/`shifts`.
Сохранённые смены, тарифы пользователей и существующие секреты не менялись.
Обе Edge Functions обновлены из исходников веб-версии V1.02:
`telegram-mypay` — версия **15**, `telegram-reminders` — версия **3**; обе `ACTIVE`.

Для повторного применения из корня репозитория:

```bash
supabase login
supabase projects list

# Один SQL-update в транзакции: Telegram-схема/RPC и только defaults оплаты.
supabase db query --linked --project-ref dyixwxxpjmyycgigcbtx \
  --file supabase/updates/20261024_refresh_telegram_and_pay_defaults.sql

# Явно называем обе функции: остальные функции проекта не затрагиваются.
supabase functions deploy telegram-mypay telegram-reminders \
  --project-ref dyixwxxpjmyycgigcbtx --use-api --no-verify-jwt

supabase functions list --project-ref dyixwxxpjmyycgigcbtx
```

Проверенный CLI: Supabase 2.118.0. Команда `db query --linked --project-ref` использует
авторизованный Management API; Docker и пароль БД для этого обновления не потребовались.
SQL-update применяется напрямую, без `db push` и без записи в историю Supabase migrations.
Не запускайте полный `SUPABASE_SCHEMA.sql` ради одних defaults: в нём есть отдельные
миграции исторических тарифов. Для этого обновления используется только файл из `supabase/updates/`.

`--no-verify-jwt` сохраняет существующий режим функций: бот проверяет
`X-Telegram-Bot-Api-Secret-Token`, напоминания — `Authorization: Bearer <service role key>`.
Токен бота и webhook secret остаются в Supabase Secrets. Не вставляйте их в GitHub или инструкции.

Контроль после обновления:

- В списке функций обе имеют статус `ACTIVE` и увеличенные версии.
- `GET /functions/v1/telegram-mypay` возвращает `200` и имя сервиса.
- POST вебхука с неправильным секретом и запуск напоминаний без ключа возвращают `401`.
- У RPC `create_telegram_link_code()` включён `SECURITY DEFINER`, execute разрешён
  `authenticated` и запрещён `anon`; код имеет 12 шестнадцатеричных символов.
- Defaults: обычная ставка `2415`, праздничная `4600`, цена чехла `7`, процент `25`,
  опорная дата по Екатеринбургу; `shifts.base_pay` и `total_pay` по умолчанию `2415`.

В production дополнительно проверено выполнение RPC от роли `authenticated` внутри
транзакции с `ROLLBACK`: тестовый код не остался в базе, старый код аккаунта сохранён.
Эти проверки не отправляют Telegram-сообщений. Доставка пользователю и фактическое
выполнение cron — отдельные проверки, они не следуют автоматически из успешного деплоя.

## Напоминания по расписанию

Что рассылается (по времени Екатеринбурга): в 19:00 — «сколько чехлов сегодня?» с кнопками +500/+1000/+1500, если день рабочий по графику, а смена не внесена; в `reminder_hour` (по умолчанию 21:00, меняется кнопкой в `/settings`) — «завтра рабочая смена» с прогрессом месяца; в `reminder_hour` последнего дня месяца — итоги месяца.

Функция `telegram-reminders` должна вызываться раз в час. В Supabase включи расширения **pg_cron** и **pg_net** (Database → Extensions) и создай задачу:

```sql
select cron.schedule(
  'telegram-reminders-hourly',
  '5 * * * *',
  $$
  select net.http_post(
    url     := 'https://PROJECT_REF.supabase.co/functions/v1/telegram-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

Ключ положи в Vault заранее: `select vault.create_secret('SERVICE_ROLE_KEY', 'service_role_key');`.
Функция проверяет заголовок `Authorization: Bearer <service role key>` и без него отвечает 401.
Час напоминания «завтра смена» хранится в `telegram_preferences.reminder_hour` (по умолчанию 21).

## Команды для BotFather (`/setcommands`)

Бот выставляет их сам при `/start`; список ниже — если хочется задать вручную.

```text
today - 📦 Смена за сегодня
month - 📊 Итоги месяца
forecast - 🔮 Прогноз до конца месяца
calendar - 📅 Календарь смен
undo - ↩️ Отменить последнее добавление
holiday - 🎉 Праздничная ставка на сегодня
settings - ⚙️ Настройки и напоминания
help - ❓ Как пользоваться
```


## Проверка и отладка

```bash
npm test                  # тесты бота и приложения
npm run typecheck         # tsc --strict для функций
supabase functions logs telegram-mypay
```

Бот отвечает Telegram статусом 200 даже при внутренней ошибке (иначе Telegram будет повторять доставку), а пользователю пишет «Не получилось обработать сообщение». Подробности — в логах функции и в `telegram_bot_events`.

Токен бота и service-role-ключ никогда не добавляй в GitHub, фронтенд или SQL-файлы.
