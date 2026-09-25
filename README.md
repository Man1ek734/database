# LSSD Records Database

System bazy danych dla **Los Santos Sheriff's Department**.

## Co jest już zrobione

### Strona WWW
- dashboard LSSD
- logowanie przez Supabase Auth
- wszystkie raporty
- osobne sekcje:
  - DTU
  - SERT
  - IAD
  - Deputy
- wyszukiwarka
- rejestr awansów
- rejestr degradacji
- rejestr zwolnień
- automatyczne statystyki
- responsywny wygląd na telefon i komputer

### Discord Bot
Jedna komenda:

```
/database
```

Po użyciu pojawia się menu:
- Raport DTU
- Raport SERT
- Raport IAD
- Raport Deputy
- Awans
- Degradacja
- Zwolnienie

Raport zapisuje się w Supabase i pojawia na stronie.

Zmiany kadrowe:
1. awans, degradacja albo zwolnienie zapisuje się w Supabase,
2. pojawia się w odpowiedniej zakładce na stronie,
3. bot publikuje embed na odpowiednim kanale Discord.

## Struktura repo

```
database/
├── index.html
├── style.css
├── app.js
├── config.js
├── supabase/
│   └── schema.sql
└── bot/
    ├── index.js
    ├── package.json
    └── .env.example
```

## 1. Supabase

Utwórz projekt Supabase, a następnie w **SQL Editor** uruchom zawartość:

```
supabase/schema.sql
```

Potem w **Authentication** utwórz konta funkcjonariuszy, którzy mają mieć dostęp do strony.

## 2. Połączenie strony z Supabase

W pliku `config.js` wpisz:

```js
window.LSSD_CONFIG = {
  SUPABASE_URL: "https://TWOJ-PROJEKT.supabase.co",
  SUPABASE_ANON_KEY: "PUBLICZNY_ANON_KEY"
};
```

**Nie wpisuj SERVICE_ROLE_KEY do config.js.**

## 3. Bot Discord

Skopiuj:

```
bot/.env.example
```

jako:

```
bot/.env
```

i uzupełnij wartości.

Najważniejsze:
- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PROMOTION_CHANNEL_ID`
- `DEMOTION_CHANNEL_ID`
- `DISMISSAL_CHANNEL_ID`
- opcjonalnie `DATABASE_LOG_CHANNEL_ID`

Następnie:

```bash
cd bot
npm install
npm start
```

## Bezpieczeństwo

- token Discorda nigdy nie trafia do GitHuba,
- `SUPABASE_SERVICE_ROLE_KEY` nigdy nie trafia do strony,
- strona ma tylko publiczny `anon key`,
- odczyt raportów wymaga zalogowanego konta Supabase,
- zapis do tabel wykonywany jest przez bota po stronie serwera.

## Hosting

- **strona:** GitHub Pages
- **baza danych:** Supabase
- **bot Discord:** Railway / Render / VPS

---

**Los Santos Sheriff's Department**  
Station 28 — Davis Avenue  
Service • Integrity • Community
