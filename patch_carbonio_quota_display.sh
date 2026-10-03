#!/bin/bash
# =============================================================================
# Патч: исправление отображения квот в разделе "Лимит почтового ящика"
# в Carbonio CE (домены → свойства домена → Лимит почтового ящика)
#
# СИМПТОМ: у всех ящиков показывается "0.00 ГБ" использования, хотя
#          сортировка по занятому месту работает корректно.
#
# ПРИЧИНА: carbonio-admin-ui использует поля mailsQuotaUsed/mailsQuotaLimit
#          (из REST API Storages/Advanced), но в CE данные берутся через
#          SOAP GetQuotaUsage, который возвращает поля used/limit.
#          Функция-трансформер читает undefined и показывает 0 для всех ящиков.
#
# ДВЕ ВЕРСИИ СБОРКИ (детект по содержимому shell.mjs):
#   v1 — admin-console-ui 0.12.x (CE 26.3): функции Mfe/Efe/X2, объект `u`.
#   v2 — admin-console-ui 0.13.x (CE 26.6, Vite-переписана): t8/e8/n6, объект `e`.
#   v3 — admin-console-ui 0.15.x: k6/V3 (трансформер A6).
#   Если ни один набор не найден — сборка снова изменилась, добавьте v4.
#
# СОВМЕСТИМОСТЬ: Carbonio CE 26.x, Ubuntu 22.04 и 24.04 (нужен python3 либо node).
#
# ПРИМЕНЕНИЕ:
#   bash patch_carbonio_quota_display.sh          # применить патч
#   bash patch_carbonio_quota_display.sh --check  # проверить статус
#   bash patch_carbonio_quota_display.sh --revert # откатить
# =============================================================================

SHELL_MJS="/opt/zextras/admin/iris/carbonio-admin-ui/shell.mjs"
BACKUP_SUFFIX=".bak_quota_$(date +%Y%m%d_%H%M%S)"
MODE="${1:-apply}"

run_core() {
    # $1 = mode (apply|check), передаётся в интерпретатор; печатает STATUS:* и код возврата
    local runner=""
    if command -v python3 &>/dev/null; then runner="python3";
    elif command -v node &>/dev/null; then runner="node"; fi

    if [ "$runner" = "python3" ]; then
        python3 - "$SHELL_MJS" "$1" <<'PYEOF'
import sys
path, mode = sys.argv[1], sys.argv[2]
# Пары (старое, новое) по вариантам сборки. Вариант применяется, если ВСЕ его
# "старые" строки присутствуют; считается применённым, если все "новые" есть.
VARIANTS = {
 "v1": [
   ('Mfe=(n,l,i=!1)=>{const s=[];return n.forEach(u=>{const[f,b]=Efe(u?.mailsQuotaUsed??0,u.mailsQuotaLimit??0,l),T={name:i?u?.accountName:u?.name,id:i?u?.accountId:u?.id,mailsQuota:f,mailsQuotaUsed:X2(u?.mailsQuotaUsed||0).toFixed(2),mailsQuotaUsedPercentage:b.toFixed(0)}',
    'Mfe=(n,l,i=!1)=>{const s=[];return n.forEach(u=>{const r=u?.mailsQuotaUsed??u?.used??0,t=u?.mailsQuotaLimit??u?.limit??0,[f,b]=Efe(r,t,l),T={name:i?u?.accountName:u?.name,id:i?u?.accountId:u?.id,mailsQuota:f,mailsQuotaUsed:X2(r||0).toFixed(2),mailsQuotaUsedPercentage:b.toFixed(0)}'),
 ],
 "v2": [
   ('e8(e?.mailsQuotaUsed??0,e.mailsQuotaLimit??0,t)',
    'e8(e?.mailsQuotaUsed??e?.used??0,e.mailsQuotaLimit??e?.limit??0,t)'),
   ('mailsQuotaUsed:n6(e?.mailsQuotaUsed||0).toFixed(2)',
    'mailsQuotaUsed:n6(e?.mailsQuotaUsed??e?.used??0).toFixed(2)'),
 ],
 "v3": [
   ('k6(e?.mailsQuotaUsed??0,e.mailsQuotaLimit??0,t)',
    'k6(e?.mailsQuotaUsed??e?.used??0,e.mailsQuotaLimit??e?.limit??0,t)'),
   ('mailsQuotaUsed:V3(e?.mailsQuotaUsed||0).toFixed(2)',
    'mailsQuotaUsed:V3(e?.mailsQuotaUsed??e?.used??0).toFixed(2)'),
 ],
}
try:
    c = open(path, encoding='utf-8', errors='replace').read()
except OSError as e:
    print("STATUS:ERROR file %s" % e); sys.exit(2)

def detect(c):
    for name, pairs in VARIANTS.items():
        if all(o in c for o, _ in pairs): return name, "unpatched"
        if all(n in c for _, n in pairs): return name, "patched"
    return None, None

name, state = detect(c)
if mode == "check":
    if state == "patched": print("STATUS:PATCHED %s" % name); sys.exit(0)
    if state == "unpatched": print("STATUS:UNPATCHED %s" % name); sys.exit(1)
    print("STATUS:UNKNOWN"); sys.exit(3)

# apply
if state == "patched":
    print("STATUS:ALREADY %s" % name); sys.exit(0)
if state != "unpatched":
    print("STATUS:UNKNOWN"); sys.exit(3)
for o, n in VARIANTS[name]:
    if c.count(o) != 1:
        print("STATUS:ERROR ambiguous %r (count=%d)" % (o[:30], c.count(o))); sys.exit(4)
    c = c.replace(o, n, 1)
open(path, "w", encoding="utf-8").write(c)
print("STATUS:APPLIED %s" % name); sys.exit(0)
PYEOF
        return $?
    elif [ "$runner" = "node" ]; then
        node - "$SHELL_MJS" "$1" <<'NODEEOF'
const fs = require('fs');
const [path, mode] = process.argv.slice(1);
const VARIANTS = {
 v1: [[
   'Mfe=(n,l,i=!1)=>{const s=[];return n.forEach(u=>{const[f,b]=Efe(u?.mailsQuotaUsed??0,u.mailsQuotaLimit??0,l),T={name:i?u?.accountName:u?.name,id:i?u?.accountId:u?.id,mailsQuota:f,mailsQuotaUsed:X2(u?.mailsQuotaUsed||0).toFixed(2),mailsQuotaUsedPercentage:b.toFixed(0)}',
   'Mfe=(n,l,i=!1)=>{const s=[];return n.forEach(u=>{const r=u?.mailsQuotaUsed??u?.used??0,t=u?.mailsQuotaLimit??u?.limit??0,[f,b]=Efe(r,t,l),T={name:i?u?.accountName:u?.name,id:i?u?.accountId:u?.id,mailsQuota:f,mailsQuotaUsed:X2(r||0).toFixed(2),mailsQuotaUsedPercentage:b.toFixed(0)}']],
 v2: [
   ['e8(e?.mailsQuotaUsed??0,e.mailsQuotaLimit??0,t)','e8(e?.mailsQuotaUsed??e?.used??0,e.mailsQuotaLimit??e?.limit??0,t)'],
   ['mailsQuotaUsed:n6(e?.mailsQuotaUsed||0).toFixed(2)','mailsQuotaUsed:n6(e?.mailsQuotaUsed??e?.used??0).toFixed(2)']],
 v3: [
   ['k6(e?.mailsQuotaUsed??0,e.mailsQuotaLimit??0,t)','k6(e?.mailsQuotaUsed??e?.used??0,e.mailsQuotaLimit??e?.limit??0,t)'],
   ['mailsQuotaUsed:V3(e?.mailsQuotaUsed||0).toFixed(2)','mailsQuotaUsed:V3(e?.mailsQuotaUsed??e?.used??0).toFixed(2)']],
};
let c;
try { c = fs.readFileSync(path, 'utf8'); } catch (e) { console.log('STATUS:ERROR file'); process.exit(2); }
const cnt = (s, sub) => s.split(sub).length - 1;
let name = null, state = null;
for (const [nm, pairs] of Object.entries(VARIANTS)) {
  if (pairs.every(([o]) => c.includes(o))) { name = nm; state = 'unpatched'; break; }
  if (pairs.every(([, n]) => c.includes(n))) { name = nm; state = 'patched'; break; }
}
if (mode === 'check') {
  if (state === 'patched') { console.log('STATUS:PATCHED ' + name); process.exit(0); }
  if (state === 'unpatched') { console.log('STATUS:UNPATCHED ' + name); process.exit(1); }
  console.log('STATUS:UNKNOWN'); process.exit(3);
}
if (state === 'patched') { console.log('STATUS:ALREADY ' + name); process.exit(0); }
if (state !== 'unpatched') { console.log('STATUS:UNKNOWN'); process.exit(3); }
for (const [o, n] of VARIANTS[name]) {
  if (cnt(c, o) !== 1) { console.log('STATUS:ERROR ambiguous'); process.exit(4); }
  c = c.replace(o, n);
}
fs.writeFileSync(path, c);
console.log('STATUS:APPLIED ' + name); process.exit(0);
NODEEOF
        return $?
    else
        echo "ERROR: не найден ни python3, ни node — невозможно обработать патч" >&2
        return 5
    fi
}

if [ ! -f "$SHELL_MJS" ]; then
    echo "ERROR: файл не найден: $SHELL_MJS" >&2
    exit 2
fi

case "$MODE" in
  --check)
    out=$(run_core check); rc=$?
    echo "$out"
    case "$rc" in
      0) echo "СТАТУС: патч уже применён" ;;
      1) echo "СТАТУС: патч НЕ применён (баг присутствует)" ;;
      3) echo "СТАТУС: неизвестная версия shell.mjs (сборка изменилась — нужен новый вариант)" ;;
    esac
    exit $rc ;;
  --revert)
    BACKUP=$(ls "${SHELL_MJS}".bak_quota_* 2>/dev/null | sort | tail -1)
    if [ -z "$BACKUP" ]; then echo "ERROR: бэкап не найден (${SHELL_MJS}.bak_quota_*)" >&2; exit 1; fi
    echo "Восстанавливаю из: $BACKUP"
    cp "$BACKUP" "$SHELL_MJS"
    echo "Готово. Версия восстановлена."
    exit 0 ;;
  *)
    # apply: сначала проверим, что не применён и вариант известен
    st=$(run_core check); rc=$?
    if [ "$rc" = "0" ]; then echo "Патч уже применён, ничего не делаю."; exit 0; fi
    if [ "$rc" = "3" ]; then
      echo "ERROR: целевые строки не найдены — сборка admin-console-ui изменилась." >&2
      echo "Снимите новые идентификаторы с shell.mjs и добавьте вариант в VARIANTS." >&2
      exit 1
    fi
    echo "Создаю бэкап: ${SHELL_MJS}${BACKUP_SUFFIX}"
    cp "$SHELL_MJS" "${SHELL_MJS}${BACKUP_SUFFIX}"
    out=$(run_core apply); rc=$?
    echo "$out"
    if [ "$rc" = "0" ]; then
      echo "Патч успешно применён."
      echo "Попросите администраторов обновить страницу админки (Ctrl+Shift+R)."
      # права владельца (не критично вне сервера)
      chown zextras:zextras "$SHELL_MJS" 2>/dev/null || true
    else
      echo "ОШИБКА при применении. Восстанавливаю бэкап..." >&2
      cp "${SHELL_MJS}${BACKUP_SUFFIX}" "$SHELL_MJS"
      exit 1
    fi
    exit $rc ;;
esac
