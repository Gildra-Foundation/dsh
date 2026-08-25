# Gildra DSH Kit

Воспроизводимая сборка DeepSeek Harness из исходников для macOS и Windows. Комплект устанавливает отдельное окружение в домашний каталог пользователя и не переносит пароли, OAuth-сессии, токены, историю чатов или приватные рабочие файлы.

## Что входит

- DeepSeek Harness `0.1.1-rc.2`, закреплённый на commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
- Профиль **Engineering** с Codex и Claude Code subagents.
- Интернет-поиск DuckDuckGo, GenUI, Archify, CodeGraph, Context, Context Doctor, Security Audit и `@file`.
- `dsh-automation` 0.1.7: отдельные фоновые Agent-сессии, расписания, история запусков, выбор provider/model/reasoning и управление через инструменты `automation_*`.
- Компактный Context Doctor: индикатор 31×27 px без перекрывающей интерфейс панели; аудит и Agent-инструмент продолжают работать.
- Нативная оболочка macOS и ярлык desktop-app для Windows через Edge WebView.

## Установка

### macOS

Скачайте архив `Gildra-DSH-macOS.zip`, распакуйте и дважды нажмите `Install Gildra DSH.command`.

Окружение устанавливается в `~/.gildra-dsh`, приложение — в `~/Applications/Gildra DSH.app`. Сборка подписана ad-hoc и не нотарифицирована: для публичного распространения без предупреждения Gatekeeper нужен сертификат Apple Developer ID и notarization.

### Windows

Скачайте `Gildra-DSH-Windows.zip`, распакуйте и запустите `Install Gildra DSH.cmd`. Установщик скачает закреплённый portable Node.js, исходники Harness и плагины, затем создаст ярлык **Gildra DSH** на рабочем столе.

CodeGraph включается автоматически, если найден `python3` на macOS или `python` в Windows. Без Python остаётся доступен Archify.

## Первый запуск

Откройте **Settings → Subscriptions** и войдите в Codex и/или Claude. Учётные данные создаются отдельно на каждом компьютере и никогда не находятся в репозитории.

Автоматизации доступны из боковой панели **Automations**. Сначала запускайте новую задачу кнопкой **Run now** и проверяйте результат. Для фонового исправления кода используйте `workspace-write`; `danger-full-access` намеренно недоступен.

Готовые безопасные шаблоны находятся в [`templates/automations`](templates/automations).

## Обновление и воспроизводимость

Все внешние исходники закреплены версиями или commit SHA в [`config/versions.env`](config/versions.env) и установщиках. Повторный запуск установщика обновляет пакеты, сохраняя отдельный DSH home. Перед изменением версий проверяйте совместимость с `0.1.1-rc.2`.

## Проверки

```bash
./scripts/verify.sh
```

Проверка валидирует конфигурацию, JavaScript, shell-скрипты, PowerShell на Windows runner и собирает macOS app. Полноценные Windows и macOS архивы создаёт GitHub Actions.

## Безопасность

- В репозитории нет `.dsh` пользователя, credentials, cookies, session logs или рабочих проектов.
- Автоматизации работают только в зарегистрированном workspace и только с `read-only` или `workspace-write`.
- Никакой автоматический commit, push, deploy, DNS-операции или вызов платного провайдера не включены по умолчанию.
- Автоматическое восстановление парсера — одна ограниченная попытка с сохранением LKG и обязательной валидацией результата.

DeepSeek Harness и сторонние плагины сохраняют собственные лицензии. Desktop-оболочка основана на MIT-проекте `Carleo10032/deepseek-harness-mac`.
