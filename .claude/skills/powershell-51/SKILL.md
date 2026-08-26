---
name: powershell-51
description: Правила Windows-кода в Gildra DSH — PowerShell 5.1, .cmd-обёртки и вызовы powershell.exe из Node. Используй ВСЕГДА при любой правке install/*.ps1, install/*.cmd, корневых «* Gildra DSH.cmd», Windows-веток scripts/*.mjs (spawn powershell.exe) или windows-джобы CI — в этом репозитории уже были два критических бага из-за семантики Windows PowerShell 5.1, и «очевидные» правки здесь опасны. Триггерься на: powershell, windows installer, Expand-Archive, Stop-Process, $LASTEXITCODE, Invoke-WebRequest.
---

# PowerShell 5.1 в Gildra DSH

Весь Windows-код кита исполняется через `powershell.exe` — это **Windows
PowerShell 5.1**, не pwsh 7. У него другая семантика ошибок и параметров, и
именно на ней проект уже дважды обжигался. Правила ниже — не стиль, а
предохранители.

## 1. Коды возврата exe не останавливают скрипт

`$ErrorActionPreference = 'Stop'` действует на командлеты, но **не** на
нативные команды (node, corepack, git, tar). Упавший `pnpm install` в 5.1 молча
едет дальше. После каждой нативной команды проверяй `$LASTEXITCODE`:

```powershell
& $node $configureProfile @args
if ($LASTEXITCODE -ne 0) { throw "configure-profile failed: $LASTEXITCODE" }
```

Лучше — один хелпер `Invoke-Checked` в начале скрипта и вызовы через него.

## 2. `-Command` не передаёт аргументы

`powershell.exe -Command '<скрипт с $args[0]>' арг1 арг2` — ловушка: `$args`
заполняется **только с `-File`**; с `-Command` всё после строки приклеивается к
тексту команды как посторонние токены. Для вызова PowerShell из Node с
аргументами: записать временный `.ps1` и запустить `-File путь арг1 арг2`,
либо `-EncodedCommand` с уже подставленными экранированными литералами.

## 3. Ловушка пустого фильтра при остановке процессов

В `scripts/gildra-update.mjs` (`stopApplication`) фильтр
`$_.CommandLine -like "*$needle*"` при пустом `$needle` вырождается в
`-like "**"` — совпадение с **любым** процессом, а дальше стоит
`Stop-Process -Force`. Любая правка этого кода обязана сначала гарантировать
непустой `$needle` (guard + throw), и только потом чинить доставку аргумента.
Не убирай «лишний» хвостовой аргумент, не поставив guard.

## 4. Квотирование путей

Windows-пути пользователей содержат пробелы (`C:\Users\John Doe\…`). Node с
`shell: true` не квотирует ни команду, ни аргументы (`scripts/kit-config.mjs`,
`run()`), и CI это не ловит — у runner'ов пути без пробелов. Внутри .ps1 всегда
`& "$path"` в кавычках; из Node — оборачивай в кавычки сам или избегай shell.

## 5. Мелочи, которые выглядят как «не важно»

- `$ProgressPreference = 'SilentlyContinue'` перед `Invoke-WebRequest` — в 5.1
  прогресс-бар замедляет большие скачивания в разы.
- В `.cmd`: `if errorlevel 1 pause` затирает код возврата (pause вернёт 0) —
  сохраняй его в переменную до pause и выходи с `exit /b`.
- Аккумулирование ошибок парсера: `[ref]$var` в `ParseFile` **перезаписывает**
  переменную на каждом вызове — собирай в отдельный список
  (`$allErrors += $errors`), иначе проверка видит только последний файл.

## 6. Проверка

Тестов на Windows-пути в репо нет, CI только парсит синтаксис. После правки:
прогони парсер локально, проследи логику глазами построчно, и если у тебя нет
реальной Windows — явно скажи пользователю, что изменение не запускалось на
Windows и что именно нужно проверить вручную.
