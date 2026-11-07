# carbonio-ce-quotas / enforce

[Русский](#русский) · [English](#english)

---

## Русский

Расширение appserver для **Carbonio CE 26.9+** (appserver 4.36+), возвращающее соблюдение квот
почтовых ящиков и письма-предупреждения о заполнении.

### Зачем

В appserver 4.36 (CE 26.9) Zextras убрал квоты из бесплатной редакции:

- `QuotaCheckSingleton.DefaultQuotaCheck` — пустые методы (в 4.27 бросал `QUOTA_EXCEEDED` → LMTP `552 Over quota`);
- класс `QuotaWarning` (письмо «ящик заполнен на N%») удалён;
- `AccountUtil.getEffectiveQuota` всегда возвращает 0 (поэтому и `GetQuotaUsage` отдаёт `limit="0"`);
- константы `A_zimbraMailQuota` / `A_zimbraMailDomainQuota` удалены из `Provisioning`.

Реальная реализация есть только в платном `carbonio-advanced`. Квоты в LDAP остаются, но ни на что
не влияют: ящик растёт сверх лимита, предупреждений нет.

### Что делает

`CuQuotaExtension` (Zimbra-расширение в `/opt/zextras/lib/ext/cu-quota-enforce/`) при старте appserver:

- ставит `CuQuotaCheck` в `QuotaCheckSingleton` — логика 4.27: действующая квота = меньшее ненулевое из
  `zimbraMailQuota` (учётка/COS) и `zimbraMailDomainQuota` домена; превышение при доставке/сохранении →
  `QUOTA_EXCEEDED`; отправка при `zimbraMailAllowReceiveButNotSendWhenOverQuota` — тоже;
- регистрирует LMTP-колбэк `CuQuotaWarning` — письмо по шаблону `zimbraQuotaWarnMessage` (COS) при
  достижении `zimbraQuotaWarnPercent` (по умолчанию 90%), не чаще `zimbraQuotaWarnInterval` (1d),
  отметка `zimbraQuotaLastWarnTime`. Отличие от 4.27: само предупреждение доставляется в обход квоты
  (раньше в полный ящик оно не доходило).

Агрегатная квота домена (`zimbraDomainAggregateQuota`) не реализована — её функции в 4.36 удалены.

### Требования

Carbonio CE с appserver **4.36+** (CE 26.9+), Ubuntu 22.04 / 24.04, `unzip`. JDK берётся из
`/opt/zextras/common/lib/jvm/java` (входит в Carbonio). Установщик откажется работать на старом
appserver, где квоты ещё штатные.

### Установка / обновление

```bash
git clone https://github.com/mapazzzm/carbonio-ce-quotas.git
cd carbonio-ce-quotas/enforce
sudo bash install.sh              # сборка против jar установленного appserver + установка + перезапуск appserver
sudo bash install.sh --no-restart # без перезапуска
sudo bash install.sh --uninstall  # удалить
```

Повторный запуск (`git pull && sudo bash install.sh`) обновляет установленную версию.
Файлы лежат вне пакетов Carbonio — `apt upgrade` их не удаляет, но **после каждого
`apt upgrade carbonio-appserver` пересоберите** (`sudo bash install.sh`): внутренний API может
измениться. Проверка после старта:

```bash
grep -a "cu-quota-enforce: quota check installed" /opt/zextras/log/mailbox.log | tail -1
```

Порог и интервал предупреждений — атрибуты COS `zimbraQuotaWarnPercent` / `zimbraQuotaWarnInterval`
(`zmprov mc default zimbraQuotaWarnPercent 90`). В админке 0.20.x их можно править в разделе квот
домена, если установлен [`rest-shim/`](../rest-shim) этого же репозитория.

### Проверено (Carbonio CE 26.9.0, appserver 4.36.6)

Тестовый ящик, квота 1 МБ: до установки письмо 1,44 МБ принималось; после — письмо до 91% принято
и пришло предупреждение, письмо сверх квоты — `552 5.2.2 Over quota`.

### Лицензия

GNU AGPL v3.0 — как и сам Carbonio CE. См. [LICENSE](../LICENSE).

---

## English

An appserver extension for **Carbonio CE 26.9+** (appserver 4.36+) that brings back mailbox quota
enforcement and the "mailbox almost full" warning messages.

### Why

In appserver 4.36 (CE 26.9) Zextras removed quotas from the free edition:

- `QuotaCheckSingleton.DefaultQuotaCheck` has empty methods (in 4.27 it threw `QUOTA_EXCEEDED` → LMTP `552 Over quota`);
- the `QuotaWarning` class (the "mailbox is N% full" message) is gone;
- `AccountUtil.getEffectiveQuota` always returns 0 (so `GetQuotaUsage` reports `limit="0"`);
- the `A_zimbraMailQuota` / `A_zimbraMailDomainQuota` constants were removed from `Provisioning`.

The real implementation only exists in the paid `carbonio-advanced`. Quotas stay in LDAP but have no
effect: mailboxes grow past the limit and no warnings are sent.

### What it does

`CuQuotaExtension` (a Zimbra extension in `/opt/zextras/lib/ext/cu-quota-enforce/`) on appserver start:

- installs `CuQuotaCheck` into `QuotaCheckSingleton` — the 4.27 logic: the effective quota is the
  smaller non-zero value of `zimbraMailQuota` (account/COS) and the domain `zimbraMailDomainQuota`;
  exceeding it on delivery/save → `QUOTA_EXCEEDED`; sending is checked too when
  `zimbraMailAllowReceiveButNotSendWhenOverQuota` is set;
- registers the `CuQuotaWarning` LMTP callback — a message from the COS `zimbraQuotaWarnMessage`
  template when `zimbraQuotaWarnPercent` (default 90%) is reached, at most once per
  `zimbraQuotaWarnInterval` (1d), tracked in `zimbraQuotaLastWarnTime`. Unlike 4.27, the warning
  itself bypasses the quota (previously it never reached a full mailbox).

The aggregate domain quota (`zimbraDomainAggregateQuota`) is not implemented — its functions were removed in 4.36.

### Requirements

Carbonio CE with appserver **4.36+** (CE 26.9+), Ubuntu 22.04 / 24.04, `unzip`. The JDK is taken from
`/opt/zextras/common/lib/jvm/java` (shipped with Carbonio). The installer refuses to run on older
appservers where quotas are still built in.

### Install / update

```bash
git clone https://github.com/mapazzzm/carbonio-ce-quotas.git
cd carbonio-ce-quotas/enforce
sudo bash install.sh              # build against the installed appserver jars + install + restart appserver
sudo bash install.sh --no-restart
sudo bash install.sh --uninstall
```

Re-running (`git pull && sudo bash install.sh`) updates an existing install. The files live outside
Carbonio packages, so `apt upgrade` does not remove them, but **rebuild after every
`apt upgrade carbonio-appserver`** (`sudo bash install.sh`): the internal API may change. Check after start:

```bash
grep -a "cu-quota-enforce: quota check installed" /opt/zextras/log/mailbox.log | tail -1
```

The warning threshold and interval are the COS attributes `zimbraQuotaWarnPercent` /
`zimbraQuotaWarnInterval` (`zmprov mc default zimbraQuotaWarnPercent 90`). In admin-console-ui 0.20.x
they can be edited in the domain quota section when
[`rest-shim/`](../rest-shim) from this repository is installed.

### Tested (Carbonio CE 26.9.0, appserver 4.36.6)

Test mailbox with a 1 MB quota: before installing, a 1.44 MB message was accepted; after — a message
up to 91% was accepted and the warning arrived, a message over the quota got `552 5.2.2 Over quota`.

### License

GNU AGPL v3.0 — same as Carbonio CE itself. See [LICENSE](../LICENSE).
