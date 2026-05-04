# carbonio-ce-quotas

Патч для Carbonio CE: исправление отображения занятого места в разделе «Лимит почтового ящика» в панели администратора.

A patch for Carbonio CE fixing mailbox quota usage display in the admin panel.

---

## RU Описание

### Симптом

В свойствах домена → раздел **«Лимит почтового ящика»** — у всех ящиков отображается `0.00 ГБ` использования, хотя сортировка по занятому месту работает корректно (самые большие ящики — сверху).

### Причина

`carbonio-admin-ui` получает данные о квотах через SOAP-запрос `GetQuotaUsage`, который возвращает поля `used` и `limit`. Однако функция отображения `Mfe()` обращается к полям `mailsQuotaUsed` и `mailsQuotaLimit` — это названия из REST API коммерческого пакета `carbonio-advanced`, которого нет в CE. Из-за несовпадения имён функция читает `undefined` и показывает `0.00 ГБ` для всех ящиков.

Сортировка работает, потому что она выполняется на стороне сервера до передачи данных в браузер.

### Затронутые версии

- Carbonio CE 26.x (проверено на **26.3.2**, Ubuntu 24.04 Noble)

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

- Carbonio CE 26.x (confirmed on **26.3.2**, Ubuntu 24.04 Noble)

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
