# BotMemory — файловая память для SillyTavern

Бот сам ведёт долгосрочную память в markdown-файлах и решает, когда их читать и писать. Никаких лорбуков по ключевым словам и вечных мега-инъекций: в контексте постоянно живёт только компактное ОГЛАВЛЕНИЕ (по строке на файл), а полные файлы подтягиваются по запросу модели — и потом сами «догорают».

## Как это работает

- **Индекс (INDEX)** — оглавление вида `файл — строка-выжимка` висит в промпте на настраиваемой глубине. Единственная постоянная цена в токенах.
- **Реколл (recall)** — модель решила, что файл нужен → выводит `<recall>файл.md</recall>` (или вызывает тулзу `memory_read` на API с function calling). Файл вколачивается в промпт, ответ перегенерируется на месте — никаких пустых сообщений в чате. Прочитанное лежит на **полке** N ходов (по умолчанию 8, максимум 3 файла, старые вытесняются), потом исчезает само. Пустая полка — норма.
- **Запись (remember)** — бот сам дописывает дистиллированные заметки тегом `<remember-file>` на естественной паузе (бесплатно, в составе обычного ответа) или тулзой `memory_write`. Все заметки — на английском (так модель им следует лучше).
- **Выжимка (консолидация)** — диапазон сообщений прогоняется фоновым запросом и пишется в файлы памяти; диапазон можно скрыть из контекста. Режимы: полная выжимка или «только важное». Автовыжимка каждые N сообщений — галочкой.
- **Отдельная модель для выжимки** — выбирается любой профиль из менеджера подключений (URL + модель + ключ подставляются сами); вызов делает серверный плагин, основное подключение чата не дёргается.
- **Панель в меню палочки** (✨ рядом с полем ввода): выжимка с/по, автовыжимка, время жизни полки, профиль выжимки.

Теги работают на любых моделях (даже слабых локальных); где есть function calling — используется оно (режим «Авто»).

## Требования

- SillyTavern ≥ 1.12 (разработано и проверено на 1.17.x)
- Включённые серверные плагины (см. ниже)

## Установка

**1. UI-расширение** — в таверне: *Расширения → Install Extension*: в поле URL вставить `https://github.com/Grecha-dev/SillyTavern-BotMemory` и нажать Install.

(Вручную: скопировать `manifest.json`, `index.js`, `settings.html`, `style.css` в `SillyTavern/data/default-user/extensions/botmemory/`.)

**2. Серверный плагин** — скопировать `server-plugin/index.mjs` в `SillyTavern/plugins/botmemory/index.mjs`.

**3. В `SillyTavern/config.yaml` включить серверные плагины:**

```yaml
enableServerPlugins: true
enableServerPluginsAutoLoad: true
```

**4. Перезапустить сервер таверны** и обновить вкладку браузера.

Файлы памяти лежат в `data/default-user/botmemory/<персонаж>/` — обычный markdown, можно править руками (и из панели настроек расширения).

## Использование

- Открой чат с персонажем — память уже работает.
- Меню палочки (✨) → **BotMemory**: выжать диапазон, автовыжимка, полка, профиль выжимки.
- Полные настройки (текст протокола, шаблоны выжимки, лимиты, скрытие следов): *Расширения → BotMemory*.
- Слэш-команды: `/bm-consolidate <с> <по> [hide=true|false] [selective=true|false]`, `/bm-note <файл> <текст>`.

## Приватность

Всё хранится локально на твоём хосте SillyTavern. Наружу уходит только то, куда ты сам настроил выжимку (твои endpoint'ы моделей).

## Лицензия

MIT. Проект не аффилирован с SillyTavern; использует публичные API расширений и плагинов.

---

# BotMemory — file-based memory for SillyTavern (EN)

Bots keep their own long-term memory as markdown files and decide when to read or write them. The context permanently carries only a compact INDEX (one line per file); full files are pulled on demand and expire from a bounded "shelf" after N turns. Range consolidation ("squeeze") into memory files runs as a background call — optionally through a separate cheap Connection Manager profile, with an auto mode and a selective mode.

**Install:** 1) UI extension — *Extensions → Install Extension*: URL `https://github.com/Grecha-dev/SillyTavern-BotMemory`. 2) Copy `server-plugin/index.mjs` to `SillyTavern/plugins/botmemory/`. 3) In `config.yaml`: `enableServerPlugins: true`, `enableServerPluginsAutoLoad: true`. 4) Restart the server, reload the tab.

Quick panel — wand menu (✨) by the input box. Full settings — Extensions → BotMemory. Everything is stored locally.
