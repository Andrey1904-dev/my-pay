# Этап 1 — аудит (24.10.2026)

Репозиторий: https://github.com/Andrey1904-dev/my-pay. Ветка: codex/pwa-native-redesign.
Исходный коммит: 8a4f56d9dfc43b9a8d0c7572d984c23659ec669c.

1. Изучены README, AUDIT, оба HTML, package/Vite, все модули src/app, CSS, manifest/SW, CI, тесты, SQL и Telegram. Фактическая цепочка: index → landing.js/React; app.html → script.js/esbuild → src/app/main.js. Общие тарифы находятся в supabase/functions/_shared/pay.ts.
2. Создана отдельная ветка; этот отчёт — единственное изменение этапа.
3. Пока ничего не удалено. Только лендинг использует src/components, App.tsx, main.tsx, index.css, utils/cn.ts, lib/pay.ts и React/Tailwind/motion. PWA использует style.css, fonts, src/app, общие тарифы; privacy и иконки общие.
4. Проверены реальные импорты и сценарии сборки. npm ci запущен; функциональные результаты будут записаны после выполнения QA.
5. Базовый аудит исходников завершён; проверки ещё не объявляются успешными.
6. Выявлено: auth закрывает первый запуск; счётчик требует ручного сохранения; навигация не интегрирована в историю; SW кэширует лендинг; UI очищает кэши отдельно от SW.
7. Известные ограничения: last-write-wins между устройствами, отсутствие дедупликации Telegram update_id, нет Web Push. Их исправление требует отдельной серверной работы и не входит в косметическое обновление.
8. Реализация, браузерное QA и PR ещё не выполнены.
9. Далее: единственная оболочка в index, совместимый app.html, удаление доказанно изолированного лендинга.
10. SQL/production не меняем; пользовательские данные и storage keys сохраняем. Запрещены force push, merge и production deployment без разрешения.

## ПЕРЕНОС КОНТЕКСТА ДЛЯ НОВОГО ЧАТА

Репозиторий https://github.com/Andrey1904-dev/my-pay; локально work/my-pay; ветка codex/pwa-native-redesign; последний исходный коммит 8a4f56d9dfc43b9a8d0c7572d984c23659ec669c (коммит отчёта искать через git log).
Аудит окончен. index — React-лендинг, app.html — vanilla JS PWA. Общие тарифы — supabase/functions/_shared/pay.ts, данные — myPayShifts/myPaySettings/myPayExtra и durable cloud queue. Прочитаны README/AUDIT, конфигурация, интеграции и тесты. Референс приложен в исходном чате: графитовые карточки, оранжевый акцент, крупная сумма, счётчик и компактный месяц; без рамки телефона/системных имитаций.
Следующий этап — единственная PWA-точка входа. Не менять SQL, не удалять данные, не выполнять production deploy/merge/force push. Полные тесты и визуальное QA впереди. Известные серверные ограничения выше не считать устранёнными.
