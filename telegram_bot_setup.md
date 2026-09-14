# CASE.PLACE SALARY Telegram BOT — ULTRA setup

## Возможности

- Ввод смены: `350`, `350 + 500`, `чехлы 350`.
- Автоматическое обновление смены за сегодня.
- Кнопочное меню прямо в Telegram.
- `/today` — результат за сегодня.
- `/month` — доход, чехлы, смены, средняя смена и цель.
- `/forecast` — прогноз дохода до конца месяца.
- `/last` — последняя смена.
- `/undo` — удалить сегодняшнюю запись.
- `/notify_on` и `/notify_off` — настройки напоминаний.
- `/unlink` — отвязать Telegram.
- Защита webhook через secret token.
- Все операции сохраняются в `telegram_bot_events`.

## Установка

1. Создай бота через `@BotFather` → `/newbot`.
2. Выполни весь файл `TELEGRAM_SUPABASE.sql` в Supabase SQL Editor.
3. Создай Edge Function `telegram-mypay` и вставь `supabase/functions/telegram-mypay/index.ts`.
4. Добавь Secrets:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_WEBHOOK_SECRET`
   - стандартный `SUPABASE_URL`
   - стандартный `SUPABASE_SERVICE_ROLE_KEY`
5. Для Edge Function отключи JWT-проверку: `verify_jwt = false`.
6. Установи webhook:

```text
https://api.telegram.org/botТОКЕН/setWebhook?url=https://PROJECT_REF.supabase.co/functions/v1/telegram-mypay&secret_token=СЕКРЕТ
```

7. В CASE.PLACE SALARY открой `Ещё → Telegram-бот → Получить код`.
8. Отправь боту `/start КОД`.

## Команды BotFather

```text
start - Привязать CASE.PLACE SALARY
menu - Открыть меню
help - Помощь
today - Результат сегодня
month - Итог месяца
forecast - Прогноз зарплаты
last - Последняя смена
undo - Отменить сегодняшнюю запись
notify_on - Включить напоминания
notify_off - Выключить напоминания
unlink - Отвязать Telegram
```

Токен бота никогда не добавляй в GitHub или frontend.
