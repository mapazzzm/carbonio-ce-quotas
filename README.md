# carbonio-ce-quotas

Квоты почтовых ящиков в **Carbonio CE**: отображение в панели администратора и соблюдение сервером.
Mailbox quotas in **Carbonio CE**: the admin panel display and server-side enforcement.

| Часть / Part | Для чего / What for | Версии / Versions |
|---|---|---|
| `patch_carbonio_quota_display.sh` | «Лимит почтового ящика» показывает `0.00 ГБ` / the "Mailbox quota" list shows `0.00 GB` | admin-console-ui 0.12.x / 0.13.x / 0.15.x (CE 26.3, 26.6) |
| [`rest-shim/`](rest-shim) | экраны квот в админке не работают и скрыты / quota screens fail with 403 and are hidden | admin-console-ui 0.20.x (CE 26.9) |
| [`enforce/`](enforce) | сервер не соблюдает квоты и не шлёт предупреждения о заполнении / the server no longer enforces quotas or sends warnings | appserver 4.36+ (CE 26.9) |

На **CE 26.9** нужны обе новые части: `rest-shim/` (админка) и `enforce/` (сервер). На CE 26.3 / 26.6 —
только `patch_carbonio_quota_display.sh`. Каждая часть определяет версию сама и отказывается работать там,
где она не нужна; повторный запуск обновляет уже установленную версию.
On **CE 26.9** both new parts are needed: `rest-shim/` (admin UI) and `enforce/` (server). On CE 26.3 / 26.6 —
only `patch_carbonio_quota_display.sh`. Every part detects the version itself and refuses to run where it is not
needed; re-running updates an existing install.

```bash
git clone https://github.com/mapazzzm/carbonio-ce-quotas.git && cd carbonio-ce-quotas
# CE 26.9:
sudo python3 rest-shim/install.py install     # затем / then Ctrl+F5 в админке / in the admin console
sudo bash enforce/install.sh                  # сборка + установка + перезапуск appserver / build + install + appserver restart
# CE 26.3 / 26.6:
sudo bash patch_carbonio_quota_display.sh
```

---

## RU Описание

### Симптом

В свойствах домена → раздел **«Лимит почтового ящика»** — у всех ящиков отображается `0.00 ГБ` использования, хотя сортировка по занятому месту работает корректно (самые большие ящики — сверху).

### Причина

`carbonio-admin-ui` получает данные о квотах через SOAP-запрос `GetQuotaUsage`, который возвращает поля `used` и `limit`. Однако функция отображения `Mfe()` обращается к полям `mailsQuotaUsed` и `mailsQuotaLimit` — это названия из REST API коммерческого пакета `carbonio-advanced`, которого нет в CE. Из-за несовпадения имён функция читает `undefined` и показывает `0.00 ГБ` для всех ящиков.

Сортировка работает, потому что она выполняется на стороне сервера до передачи данных в браузер.

### Затронутые версии

- Carbonio CE 26.x — обе сборки admin-console-ui:
  - **v1** — 0.12.x (CE 26.3, функции Mfe/Efe/X2)
  - **v2** — 0.13.x (CE 26.6, Vite-переписана, t8/e8/n6)
  - **v3** — 0.15.x (Vite, k6/V3)
  
  Скрипт сам определяет версию сборки по содержимому `shell.mjs`.
  Проверено на 26.3.2 и 26.6.0; Ubuntu 22.04 и 24.04.
- **0.20.x** (CE 26.9, проверено на 0.20.6) — экраны квот переписаны на REST, старый патч неприменим →
  `rest-shim/` (ниже). `patch_carbonio_quota_display.sh` на такой сборке сам предлагает его.

### admin-console-ui 0.20.x — квоты вообще не работают (`rest-shim/`)

В 0.20.x раздела «Лимит почтового ящика» больше нет, а все экраны квот (квота учётки и её
использование, квота домена, квота COS, «Скачать отчёт по квотам») ходят в REST
`/services/storages/admin/quota/*` — он есть только в платной редакции; в CE сервис отвечает
`403 RBAC: access denied`. Сами квоты в CE хранятся в LDAP, но в appserver 4.36 сервер их больше не
соблюдает — для этого [`enforce/`](#сервер-не-соблюдает-квоты-enforce).

`rest-shim/install.py` встраивает в `shell.mjs` слой `quota-rest-shim.js`, который перехватывает эти
запросы в браузере и отвечает через штатный admin SOAP в тех же форматах JSON:

| Экран | Чтение | Запись |
|---|---|---|
| Учётка | `zimbraMailQuota` (учётка/COS) и `zimbraMailDomainQuota` домена — действует меньший ненулевой; использование — `GetMailbox` | `ModifyAccount zimbraMailQuota` (сброс — снять атрибут, наследовать COS) |
| COS | `zimbraMailQuota` COS | `ModifyCos zimbraMailQuota` |
| Домен | `zimbraMailDomainQuota` | `ModifyDomain zimbraMailDomainQuota` |
| Отчёт по домену | CSV из `GetQuotaUsage` | — |

Кроме того, в 0.20.x экраны квот **скрыты**, если не установлен `carbonio-advanced` (проверка через
`/services/catalog/services`). Скрипт точечно снимает это условие только для квот (`unlock_0.20.json`, 9 мест:
показ/загрузка/сохранение квоты учётки, раздел «Настройки квот учётных записей» домена, раздел квоты COS);
остальные функции advanced (бэкап, HSM, OTP, Legal Hold…) остаются скрыты.

В разделе квот домена добавлен блок **«Использование квот»**: сводка (занято в домене, число ящиков, ≥ порога предупреждения — из формы «Предупреждения о заполнении ящика», по умолчанию 90 %,
заполненные, самый большой) и таблица ящиков (занято / % с полосой, сортировка, поиск, постранично; столбец «Лимит»
появляется, только если лимиты ящиков различаются, иначе общий лимит — одним полем в сводке) —
замена списка «Лимит почтового ящика», убранного в 0.20. Лимит ящика — меньшее ненулевое из его квоты и квоты домена.

Квоты Files и чатов в CE не хранятся — их использование показывается как 0.
Эмуляция не зависит от минифицированных имён (кроме регулярки кнопки отчёта); разблокировка экранов — по сборке (`unlock_<версия>.json`); повторный запуск обновляет
установленную версию, `uninstall` возвращает `shell.mjs` в исходное состояние. Переприменять после
`apt upgrade carbonio-admin-console-ui`.

```bash
python3 rest-shim/install.py check
python3 rest-shim/install.py install     # затем Ctrl+F5 в админке
python3 rest-shim/install.py uninstall
```

`patch_carbonio_quota_display.sh` на 0.20.x сам предлагает (и при `apply` запускает) `rest-shim`.
Наоборот, `rest-shim` на старых сборках 0.12–0.15 (список «Лимит почтового ящика» через `GetQuotaUsage`) ничего не
меняет и подсказывает `patch_carbonio_quota_display.sh`; если shim туда уже поставлен, `uninstall` его снимает.

### Сервер не соблюдает квоты (`enforce/`)

В appserver 4.36 (CE 26.9) Zextras убрал квоты из бесплатной редакции: проверка квоты при доставке пустая
(`QuotaCheckSingleton.DefaultQuotaCheck`), письма «ящик заполнен на N%» (`QuotaWarning`) удалены — ящики
растут сверх лимита, предупреждений нет. `enforce/` — расширение appserver, возвращающее логику 4.27:
превышение → `552 5.2.2 Over quota`, предупреждение по шаблону COS `zimbraQuotaWarnMessage` при
`zimbraQuotaWarnPercent` (90%), не чаще `zimbraQuotaWarnInterval`. Порог и интервал можно менять в разделе
квот домена (блок «Предупреждения о заполнении ящика», ставит `rest-shim/`).

```bash
sudo bash enforce/install.sh             # сборка + установка + перезапуск appserver
sudo bash enforce/install.sh --uninstall
```

Пересобирать после каждого `apt upgrade carbonio-appserver`. Подробно — [enforce/README.md](enforce/README.md).

### Требования

Для применения патча нужен один из интерпретаторов: **python3** или **node**. Скрипт проверяет их наличие автоматически и использует первый доступный. На стандартной установке Carbonio CE оба присутствуют.

### Применение

Выполните на сервере Carbonio CE от root:

```bash
curl -fsSL https://raw.githubusercontent.com/mapazzzm/carbonio-ce-quotas/main/patch_carbonio_quota_display.sh | sudo bash
```

Или скачать и запустить вручную:

```bash
# Применить патч
sudo bash patch_carbonio_quota_display.sh

# Проверить статус
sudo bash patch_carbonio_quota_display.sh --check

# Откатить
sudo bash patch_carbonio_quota_display.sh --revert
```

После применения нужно сделать обновление страницы (**Ctrl+Shift+R**).

> **Важно:** патч модифицирует минифицированный JS-файл. После обновления пакета `carbonio-admin-ui` (при `apt upgrade`) его нужно применить повторно. Добавьте `--check` в свой пост-апгрейд чеклист.

---

## EN Description

### Symptom

In domain properties → **Mailbox Quota** section, all accounts show `0.00 GB` used — even though they are sorted correctly by actual usage (largest mailboxes appear first).

### Root cause

`carbonio-admin-ui` fetches quota data via SOAP `GetQuotaUsage`, which returns fields `used` and `limit`. However, the display function `Mfe()` reads `mailsQuotaUsed` and `mailsQuotaLimit` — field names from the commercial `carbonio-advanced` REST API that is not part of Carbonio CE. The mismatch causes all values to resolve to `undefined`, which displays as `0.00 GB`.

Sorting still works because it is performed server-side before data reaches the browser.

### Affected versions

- Carbonio CE 26.x: admin-console-ui 0.12.x / 0.13.x / 0.15.x — `patch_carbonio_quota_display.sh` (confirmed on **26.3.2** and **26.6.0**, Ubuntu 22.04 / 24.04)
- admin-console-ui **0.20.x** (CE 26.9, confirmed on 0.20.6) — quota screens moved to REST, the old patch does not apply → `rest-shim/` (below); `patch_carbonio_quota_display.sh` offers it automatically on such a build.

### admin-console-ui 0.20.x — quotas do not work at all (`rest-shim/`)

0.20.x drops the "Mailbox quota" list, and every quota screen (account quota and usage, domain
quota, COS quota, "Download quota report") calls the Storages REST API
`/services/storages/admin/quota/*`, which exists only in the commercial edition — in CE it answers
`403 RBAC: access denied`. The quotas themselves live in LDAP, but appserver 4.36 no longer enforces
them — see [`enforce/`](#the-server-does-not-enforce-quotas-enforce).

`rest-shim/install.py` injects `quota-rest-shim.js` into `shell.mjs`: it intercepts those requests in
the browser and serves them from the admin SOAP API in the JSON shapes the screens expect
(account: `zimbraMailQuota` of the account/COS and the domain's `zimbraMailDomainQuota`, the lower
non-zero one applies, usage via `GetMailbox`; COS: `zimbraMailQuota`; domain:
`zimbraMailDomainQuota`; report: CSV from `GetQuotaUsage`). Files/chat quotas are not stored in CE
and show as 0. The domain quota section also gets a **"Quota usage"** block (domain summary incl. mailboxes at or above the warning threshold from the "Mailbox full warnings" form + sortable,
searchable mailbox table with used / %; a Limit column appears only when mailbox limits differ, otherwise the common limit is shown once in the summary), replacing the per-mailbox list removed in 0.20. In 0.20.x the quota screens are also hidden unless `carbonio-advanced` is installed; the
installer lifts that condition for the quota screens only (`unlock_0.20.json`, 9 sites), other advanced features
stay hidden. Independent of minified identifiers (except the report-button regex); re-running
updates an existing install, `uninstall` restores the original `shell.mjs`. On legacy 0.12–0.15 builds (the SOAP
`GetQuotaUsage` quota list) `rest-shim` changes nothing and points to `patch_carbonio_quota_display.sh`.

```bash
python3 rest-shim/install.py check | install | uninstall
```

### The server does not enforce quotas (`enforce/`)

In appserver 4.36 (CE 26.9) Zextras removed quotas from the free edition: the delivery-time quota check is
empty (`QuotaCheckSingleton.DefaultQuotaCheck`) and the "mailbox is N% full" messages (`QuotaWarning`) are
gone — mailboxes grow past the limit with no warnings. `enforce/` is an appserver extension restoring the
4.27 logic: over quota → `552 5.2.2 Over quota`, a warning from the COS `zimbraQuotaWarnMessage` template at
`zimbraQuotaWarnPercent` (90%), at most once per `zimbraQuotaWarnInterval`. The threshold and interval can
be edited in the domain quota section (the "Mailbox full warnings" block added by `rest-shim/`).

```bash
sudo bash enforce/install.sh             # build + install + appserver restart
sudo bash enforce/install.sh --uninstall
```

Rebuild after every `apt upgrade carbonio-appserver`. Details — [enforce/README.md](enforce/README.md).

### Requirements

The script requires either **python3** or **node** to apply the patch. It detects which one is available and uses it automatically. Both are present in a standard Carbonio CE installation.

### Usage

Run on your Carbonio CE server as root:

```bash
curl -fsSL https://raw.githubusercontent.com/mapazzzm/carbonio-ce-quotas/main/patch_carbonio_quota_display.sh | sudo bash
```

Or download and run manually:

```bash
# Apply the patch
sudo bash patch_carbonio_quota_display.sh

# Check current status
sudo bash patch_carbonio_quota_display.sh --check

# Revert to original
sudo bash patch_carbonio_quota_display.sh --revert
```

After applying, reload the page in the browser (**Ctrl+Shift+R**).

> **Note:** The patch modifies a minified JS file. It will be lost after a `carbonio-admin-ui` package upgrade — re-run the script after each upgrade. Use `--check` to verify.

### What the patch does

```js
// Before — reads REST API field names, gets undefined in CE → shows 0.00 GB
const [f, b] = Efe(u?.mailsQuotaUsed ?? 0, u.mailsQuotaLimit ?? 0, l)
mailsQuotaUsed: X2(u?.mailsQuotaUsed || 0).toFixed(2)

// After — falls back to SOAP field names when REST fields are absent
const r = u?.mailsQuotaUsed ?? u?.used ?? 0
const t = u?.mailsQuotaLimit ?? u?.limit ?? 0
const [f, b] = Efe(r, t, l)
mailsQuotaUsed: X2(r || 0).toFixed(2)
```

---

## Лицензия / License

GNU AGPL v3.0 — как и сам Carbonio CE / same as Carbonio CE itself. См. / See [LICENSE](LICENSE).
