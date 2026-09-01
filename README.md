# Моя зарплата — версия с входом по email

## Supabase
1. Authentication → Providers → Email → **Enable email provider = ON**.
2. **Confirm email = OFF**.
3. Выполнить `supabase_schema.sql` в SQL Editor.

Пользовательский интерфейс использует только **email + пароль**. Email подтверждать не требуется.

Publishable key используется только во фронтенде; secret/service_role key не нужен.

Праздничная смена: **4050 ₽**. Сделка: `чехлы × 7 × 20%`.


## v4 additions
- Individual delete button for every saved shift in the statistics/history list.
- Monthly goal forecast based on current pace.
- PWA service worker for app-shell caching and future Push API notifications.
- Notification permission UI in the "Ещё" section.
- iPhone-friendly PWA metadata.
- Existing Supabase/Auth flow is unchanged.


## v5 additions — smart features
- Individual shift deletion in history.
- Smart monthly goal: remaining amount, estimated shifts to goal, and month forecast.
- Earnings chart for recent shifts.
- Personal records: best shift, best day, total cases, and shift streak.
- PWA/service-worker foundation and notification permission UI.
- Supabase SQL for storing Web Push subscriptions.
- Edge Function skeleton for real background push notifications on iPhone.
- Existing Auth/Supabase flow remains unchanged.

### Important for iPhone push
The app can be installed as a PWA and request notification permission. True background push notifications require:
1. HTTPS.
2. iPhone/iOS PWA installed to the Home Screen.
3. A Web Push subscription saved to `push_subscriptions`.
4. VAPID keys and a server-side Web Push sender (Supabase Edge Function).
5. A scheduled job/cron to send reminders.


## v8 final sync
Backup import now syncs settings and every shift to Supabase and verifies the cloud result. Cloud loading no longer replaces local shifts with an empty cloud result.


## v9 login fix
- Fixed a JavaScript client-name mismatch introduced in v8.
- All database queries now use the initialized `supabaseClient`.


## v10 Supabase client fix
- The application now uses one unambiguous client variable: `db`.
- All `.from()`, `.auth`, `.rpc()`, and `.storage` calls use `db`.
- Added a startup assertion so a client initialization problem produces a specific diagnostic instead of `supabase.from is not a function`.
