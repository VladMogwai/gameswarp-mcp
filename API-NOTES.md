# Steam API — проверено вручную 2026-09-09

Всё ниже работает **без ключа и без регистрации**. Проверено запросами, не по памяти.
Закэшированные ответы лежат в `test/fixtures/` — можно писать код без сети.

## Ловушка

`https://api.steampowered.com/ISteamApps/GetAppList/v2/` — **мёртв**, отдаёт 404
«Method 'GetAppList' not found». Он есть во всех туториалах. Список игр берём из SteamSpy.

## Эндпоинты

### Отзывы
```
https://store.steampowered.com/appreviews/<appid>?json=1&num_per_page=100&filter=recent&language=english
```
Максимум 100 за запрос. Пагинация курсором: в ответе поле `cursor`, его передаёшь
следующим запросом как `&cursor=<...>` (обязательно URL-encoded, там есть `+` и `=`).

Поля отзыва:
`recommendationid`, `review`, `voted_up`, `votes_up`, `votes_funny`,
`weighted_vote_score` (оценка полезности от Steam), `comment_count`,
`timestamp_created`, `timestamp_updated`, `language`, `steam_purchase`,
`received_for_free`, `written_during_early_access`, `refunded`,
`primarily_steam_deck`, `app_release_date`, `reactions`

Поля автора (`review.author`):
`steamid`, `num_games_owned`, `num_reviews`, `playtime_forever`,
`playtime_at_review` ← **часы на момент написания, ключевое для отбора**,
`playtime_last_two_weeks`, `last_played`, `personaname`, `avatar`, `profile_url`

`filter`: `recent` | `updated` | `all`. При `all` Steam сортирует по своей
полезности и пагинация ведёт себя иначе — для полной выкачки бери `recent`.

### Гистограмма отзывов во времени
```
https://store.steampowered.com/appreviewhistogram/<appid>?l=english
```
`results.rollups` — **помесячно за всю историю** (`rollup_type: "month"`),
каждая точка: `date` (unix), `recommendations_up`, `recommendations_down`.
`results.recent` — последние 30 дней подневно.

Это источник для поиска просадок рейтинга.

### Патчноуты и новости
```
https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=<appid>&count=1000
```

Поля записи: `gid`, `appid`, `title`, `url`, `is_external_url`, `author`,
`contents`, `feedlabel`, `feedname`, `feed_type`, `date` (unix).

**`gid`** — уникальный идентификатор записи. Ключ для дедупликации при повторной выкачке.

**Разделять источники надо по `feed_type`, а не по `feedlabel`:**
- `feed_type: 1` — анонс разработчика (`feedname` всегда `steam_community_announcements`)
- `feed_type: 0` — пресса (`feedname` — конкретное издание)

`feedlabel` для этого не годится: у прессы там больше десятка разных значений
(PC Gamer, PCGamesN, Rock Paper Shotgun, VG247, SteamDB, GamingOnLinux, Gamemag.ru,
eurogamer, Shacknews, pressakey.com, steam_release), а у анонсов строка может
локализоваться.

**Потолка в 500 нет.** `count=1000` для No Man's Sky вернул 715 — это вся история
игры. Проси больше, чем ожидаешь, получишь сколько есть.

**`maxlength` обрезает `contents`.** Не задавай его, если нужен полный текст.

**Разметка в `contents` — две разные:**
- у анонсов разработчика BBCode: `[p]`, `[url="..."]`, `[b]`
- у прессы HTML: `<strong>`, `<a>`
Чистить надо обе.

**Объём.** Медиана `contents` — 1178 символов, максимум около 8000.
Сто записей ≈ 174 КБ. Пять тысяч игр по сто записей ≈ **850 МБ**.
Это ответ на вопрос, хватит ли файлов вместо базы: не хватит.

**Пресса многоязычная.** Gamemag.ru пишет по-русски, остальные по-английски.
Язык записи в ответе не указан — если он нужен, определять придётся самому.

**Несуществующий appid → HTTP 403**, а не пустой список. То есть «игры нет» и
«новостей нет» различимы. У DLC новости есть, как у обычных приложений.

### Похожие игры (эталон для evals)
```
https://store.steampowered.com/recommended/morelike/app/<appid>/
```
Отдаёт HTML (~160 КБ). appid'ы достаются из атрибутов `data-ds-appid`.
Первый в списке — сама игра, его выбрасывать.

**Не давай этот список агенту** — он служит правильным ответом в eval-задаче
«найди похожие», и агент начнёт списывать.

### SteamSpy — список игр, теги, оценки
```
https://steamspy.com/api.php?request=all&page=<N>       # 1000 игр на страницу, по владельцам
https://steamspy.com/api.php?request=appdetails&appid=<appid>
```
Даёт `positive`/`negative` (для расчёта категории рейтинга), `owners` (диапазон),
`tags` — теги с весами, `price`.

### Онлайн сейчас
```
https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=<appid>
```

### Детали игры
```
https://store.steampowered.com/api/appdetails?appids=<appid>
```
Описание, жанры, категории, дата выхода, издатель, цена.
**Самый строгий по частоте запросов из всех.** Кэшируй агрессивно, между запросами
делай паузу, при отказе увеличивай её. Ответ приходит завёрнутым в `{"<appid>": {...}}`.

## Правила приличия

Steam не публикует лимиты, но при частых запросах начинает отказывать.
Пауза 1.5 секунды между запросами при выкачке фикстур проблем не вызвала.
Представляйся в `User-Agent`. Всё, что выкачал, клади в кэш и не запрашивай дважды.
