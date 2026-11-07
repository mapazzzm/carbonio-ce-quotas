#!/bin/bash
# carbonio-ce-quota-enforce — установка/обновление/удаление расширения appserver.
# Install / update / remove the appserver extension.
#   sudo bash install.sh                # собрать, установить, перезапустить appserver / build, install, restart appserver
#   sudo bash install.sh --no-restart
#   sudo bash install.sh --uninstall [--no-restart]
# Повторный запуск пересобирает расширение против текущего appserver — так обновляется
# установленная версия (запускать после каждого apt upgrade carbonio-appserver).
# Re-running rebuilds against the current appserver — this is how an existing install is updated
# (run after every apt upgrade carbonio-appserver).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DST=/opt/zextras/lib/ext/cu-quota-enforce
MAILBOX_JAR=/opt/zextras/mailbox/jars/mailbox.jar

die() { echo "ERROR / ОШИБКА: $*" >&2; exit 1; }

restart() {
  if [ "${1:-}" = "--no-restart" ]; then
    echo "перезапуск пропущен / restart skipped — run: systemctl restart carbonio-appserver.target"
    return
  fi
  echo "перезапуск / restarting carbonio-appserver ..."
  systemctl restart carbonio-appserver.target
  for _ in $(seq 1 120); do
    c=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:7072/service/admin/soap 2>/dev/null || true)
    [ "$c" != "000" ] && break
    sleep 2
  done
  chown zextras:zextras /opt/zextras/data/tmp/nginx/client 2>/dev/null || true   # Carbonio quirk after restart
  grep -a "cu-quota-enforce" /opt/zextras/log/mailbox.log | tail -2 || true
}

[ "$(id -u)" -eq 0 ] || die "запускайте от root / run as root"

if [ "${1:-}" = "--uninstall" ]; then
  rm -rf "$DST"
  echo "удалено / removed: $DST"
  restart "${2:-}"
  exit 0
fi

[ -f "$MAILBOX_JAR" ] || die "нет $MAILBOX_JAR — это не сервер Carbonio appserver / not a Carbonio appserver"
command -v unzip >/dev/null || die "нужен unzip / unzip is required (apt install unzip)"
JAR_LIST=$(unzip -l "$MAILBOX_JAR")
# here-string, не канал: при pipefail `echo | grep -q` падает по SIGPIPE на большом списке
grep -q 'com/zextras/mailbox/quota/QuotaCheckSingleton.class' <<<"$JAR_LIST" \
  || die "в appserver нет QuotaCheckSingleton — нужен appserver 4.36+ (Carbonio CE 26.9+) / appserver 4.36+ required"
if grep -q 'com/zimbra/cs/mailbox/QuotaWarning.class' <<<"$JAR_LIST"; then
  die "в этом appserver штатные квоты ещё есть (QuotaWarning) — расширение не нужно / built-in quotas still present, extension not needed"
fi

bash "$HERE/build.sh"
mkdir -p "$DST"
install -m 0644 "$HERE/build/cu-quota-enforce.jar" "$DST/cu-quota-enforce.jar"
REF=$(stat -c '%U:%G' /opt/zextras/lib/ext/carbonio 2>/dev/null || echo root:root)
chown -R "$REF" "$DST"
echo "установлено / installed: $DST/cu-quota-enforce.jar ($REF)"
restart "${1:-}"
