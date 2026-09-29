# CASE.PLACE SALARY для iPhone (Xcode / SwiftUI)

Нативное iOS-приложение с тем же аккаунтом и теми же данными, что сайт и Telegram-бот.
Папка `ios/` — готовый проект Xcode: `CasePlaceSalary.xcodeproj` + исходники в `CasePlaceSalary/`.

## Требования

- macOS с **Xcode 16 или новее** (проект использует папки-группы `PBXFileSystemSynchronizedRootGroup`);
- iPhone или симулятор с **iOS 16.0+** — это все iPhone от iPhone 8 / X и новее, то есть все модели, которые Apple поддерживает сегодня;
- аккаунт Apple Developer (для запуска на устройстве хватает бесплатного, для App Store — платный);
- интернет при первом открытии проекта: Xcode подтянет пакет `supabase-swift` (SPM, `upToNextMajor 2.20.0`).

Сборка происходит **только в Xcode на Mac** — в этой среде нет компилятора Swift, поэтому код написан консервативно (Swift 5, iOS 16 API, без `@Observable`/`#Preview`) и должен собираться сразу; если Xcode всё же покажет ошибки, они будут точечными.

## Быстрый старт

1. Откройте `ios/CasePlaceSalary.xcodeproj`.
2. **Signing & Capabilities** → выберите свою Team. Bundle ID по умолчанию `ru.caseplace.salary` — можно поменять на свой (тогда обновите его и в Apple Developer / Supabase, см. ниже).
3. Дождитесь загрузки пакета Supabase (File → Packages → Resolve Package Versions, если нужно).
4. Выберите симулятор iPhone и нажмите **Run** (⌘R).

## Что умеет приложение

Полный паритет с сайтом v17:

| Вкладка | Функции |
| --- | --- |
| Сегодня | ввод чехлов (+100/+500/+1000/+1500, ±100), праздничная ставка, итог смены, счётчик «смена идёт / ближайшая смена», прогресс цели месяца, прогноз, шаблоны смен |
| Календарь | график 2/2, внесённые смены, окно смены (чехлы, часы, премия, заметка, шаблоны), удаление с отменой, очистка месяца |
| Статистика | заработок/цель, средняя смена, лучшая смена, серия, график по сменам (Swift Charts), сравнение месяцев года, список смен |
| Финансы | счета и балансы, доходы/расходы/переводы, категории и лимиты, регулярные платежи, долги, копилки (цели) с историей, аванс/зарплата, советник |
| Ещё | профиль, синхронизация, Telegram-привязка, настройки расчёта и графика, шаблоны смен, тема, напоминания, резервная копия (JSON, совместима с сайтом), CSV, удаление аккаунта |

Вход: **Apple**, **Google**, email + пароль, «продолжить без аккаунта» (локальный режим с последующим слиянием данных при входе).

Данные хранятся локально (`Documents/state.json`) и при входе синхронизируются с теми же таблицами Supabase, что и сайт (`settings`, `shifts`, `user_app_data.payload`, `profiles`). Изменения без сети попадают в очередь и отправляются при следующем запуске/возврате в приложение.

## Настройка Supabase для входа через Apple и Google

Проект Supabase уже используется сайтом; для iOS нужно включить провайдеров и redirect URL.

### Общее

1. **Authentication → URL Configuration → Redirect URLs** — добавьте `caseplace://auth-callback` (схема объявлена в `Info.plist`, `CFBundleURLSchemes`).
2. В SQL Editor выполните `SUPABASE_ACCOUNT.sql` из корня репозитория — он создаёт RPC `delete_own_account` (обязательное для App Store удаление аккаунта из приложения).

### Sign in with Apple

1. В [Apple Developer → Identifiers](https://developer.apple.com/account/resources/identifiers/list) откройте App ID приложения (Bundle ID из Xcode) и включите capability **Sign in with Apple** (в Xcode это уже добавлено в `CasePlaceSalary.entitlements`).
2. Supabase → **Authentication → Providers → Apple** → Enable. В поле **Client IDs** укажите Bundle ID приложения (например `ru.caseplace.salary`). Для нативного входа Secret Key не нужен — приложение передаёт `identityToken` через `signInWithIdToken`.
3. Если хотите вход через Apple и на сайте — дополнительно создайте Services ID и секрет по [инструкции Supabase](https://supabase.com/docs/guides/auth/social-login/auth-apple).

### Google

1. [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) → создайте **OAuth client ID** типа *Web application*. В Authorized redirect URIs добавьте `https://dyixwxxpjmyycgigcbtx.supabase.co/auth/v1/callback` (домен вашего проекта Supabase).
2. Supabase → **Authentication → Providers → Google** → Enable, вставьте Client ID и Client Secret.
3. Приложение открывает системное окно входа (`ASWebAuthenticationSession`) и возвращается по `caseplace://auth-callback`. Дополнительных SDK Google не требуется.

### Email

Как и раньше: **Authentication → Providers → Email**. Если включено подтверждение email, приложение покажет подсказку «проверь почту».

## Уведомления

Локальные (без сервера): «внеси смену» в 19:05 в рабочие дни без внесённой смены, «завтра рабочий день» в 21:00 накануне, «завтра платёж» в 10:00 за день до регулярного платежа. Включаются на вкладке «Ещё»; расписание пересчитывается при каждом изменении данных.

## Структура кода

```text
ios/CasePlaceSalary/
├── CasePlaceSalaryApp.swift   <- точка входа, тема, onOpenURL (OAuth callback)
├── Config.swift               <- Supabase URL/ключ, URL-схема, ссылки, часовой пояс
├── Models.swift               <- Settings / Shift / Extra (финансы) — JSON совместим с сайтом
├── PayModel.swift             <- расчёт смены, график 2/2, аналитика месяца, прогноз
├── FinanceEngine.swift        <- балансы, лимиты, регулярные, долги, копилки, советник
├── CloudService.swift         <- Supabase: auth (Apple/Google/email), таблицы, RPC
├── AppStore.swift             <- состояние приложения, локальное хранилище, очередь синхронизации
├── Notifications.swift        <- локальные напоминания
├── Theme.swift, DateUtil.swift, Formatters.swift
├── Views/                     <- SwiftUI-экраны: Root, Auth, Home, Calendar, Stats, Finance(+Editors), More, Components
├── Assets.xcassets            <- AppIcon (1024), AccentColor, LaunchBackground
├── Info.plist, CasePlaceSalary.entitlements, PrivacyInfo.xcprivacy
```

## Публикация

Пошаговый чек-лист для App Store Connect — в `APP_STORE.md` в корне репозитория.
