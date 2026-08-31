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


## v7 fix — cloud synchronization of restored backups
- Restoring a JSON backup while logged in now uploads the restored settings and every restored shift to Supabase.
- The app no longer reports "restored" as if everything were cloud-saved when the cloud write fails.
- Settings save now reports a cloud-sync failure instead of silently closing the settings dialog as successful.
