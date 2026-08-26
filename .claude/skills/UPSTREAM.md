# Происхождение вендорных скиллов

Скиллы ниже скопированы из внешних MIT-репозиториев и закреплены по commit —
в духе манифеста кита: состав фиксирован, обновление осознанное. Файлы
скопированы без изменений; для обновления замените каталог содержимым нового
коммита и поменяйте SHA здесь.

| Скилл | Источник | Commit | Лицензия |
| --- | --- | --- | --- |
| `karpathy-guidelines` | [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) | `2c606141936f1eeef17fa3043a72095b4765b9c2` | MIT |
| `test-driven-development` | [obra/superpowers](https://github.com/obra/superpowers) | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` | MIT (© 2025 Jesse Vincent) |
| `systematic-debugging` | [obra/superpowers](https://github.com/obra/superpowers) | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` | MIT (© 2025 Jesse Vincent) |
| `verification-before-completion` | [obra/superpowers](https://github.com/obra/superpowers) | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` | MIT (© 2025 Jesse Vincent) |
| `writing-plans` | [obra/superpowers](https://github.com/obra/superpowers) | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` | MIT (© 2025 Jesse Vincent) |
| `requesting-code-review` | [obra/superpowers](https://github.com/obra/superpowers) | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` | MIT (© 2025 Jesse Vincent) |

Примечания:

- Из `systematic-debugging` намеренно не скопированы файлы разработки самого
  скилла (`CREATION-LOG.md`, `test-*.md`) — рантайму они не нужны; референсы
  (`root-cause-tracing.md`, `defense-in-depth.md`, `condition-based-waiting.md`
  + пример и `find-polluter.sh`) сохранены, `SKILL.md` на них ссылается.
- `karpathy-guidelines` — интерпретация наблюдений Андрея Карпатого автором
  репозитория; сам Карпатый проект не поддерживает и не одобрял.
- Скиллы `bump-plugin`, `client-feature`, `installer-parity`, `powershell-51`,
  `release` — собственные, написаны по результатам аудита (`upgrade.md`).
