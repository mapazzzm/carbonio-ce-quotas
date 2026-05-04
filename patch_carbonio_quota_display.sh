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
#          Функция Mfe() читает undefined и показывает 0 для всех ящиков.
#
# СОВМЕСТИМОСТЬ: Carbonio CE 26.x (проверено на 26.3.2, Ubuntu 22.04)
#
# ПРИМЕНЕНИЕ:
#   bash patch_carbonio_quota_display.sh          # применить патч
#   bash patch_carbonio_quota_display.sh --check  # проверить статус
#   bash patch_carbonio_quota_display.sh --revert # откатить
# =============================================================================

SHELL_MJS="/opt/zextras/admin/iris/carbonio-admin-ui/shell.mjs"
BACKUP_SUFFIX=".bak_quota_$(date +%Y%m%d)"

OLD_STR='Mfe=(n,l,i=!1)=>{const s=[];return n.forEach(u=>{const[f,b]=Efe(u?.mailsQuotaUsed??0,u.mailsQuotaLimit??0,l),T={name:i?u?.accountName:u?.name,id:i?u?.accountId:u?.id,mailsQuota:f,mailsQuotaUsed:X2(u?.mailsQuotaUsed||0).toFixed(2),mailsQuotaUsedPercentage:b.toFixed(0)}'
NEW_STR='Mfe=(n,l,i=!1)=>{const s=[];return n.forEach(u=>{const r=u?.mailsQuotaUsed??u?.used??0,t=u?.mailsQuotaLimit??u?.limit??0,[f,b]=Efe(r,t,l),T={name:i?u?.accountName:u?.name,id:i?u?.accountId:u?.id,mailsQuota:f,mailsQuotaUsed:X2(r||0).toFixed(2),mailsQuotaUsedPercentage:b.toFixed(0)}'

check_status() {
    if [ ! -f "$SHELL_MJS" ]; then
        echo "ERROR: файл не найден: $SHELL_MJS"
        return 2
    fi
    if grep -qF "$NEW_STR" "$SHELL_MJS"; then
        echo "СТАТУС: патч уже применён"
        return 0
    elif grep -qF "$OLD_STR" "$SHELL_MJS"; then
        echo "СТАТУС: патч НЕ применён (баг присутствует)"
        return 1
    else
        echo "СТАТУС: неизвестная версия файла (возможно обновился пакет)"
        return 3
    fi
}

apply_patch() {
    if [ ! -f "$SHELL_MJS" ]; then
        echo "ERROR: файл не найден: $SHELL_MJS"
        exit 1
    fi

    if grep -qF "$NEW_STR" "$SHELL_MJS"; then
        echo "Патч уже применён, ничего не делаю."
        exit 0
    fi

    if ! grep -qF "$OLD_STR" "$SHELL_MJS"; then
        echo "ERROR: целевая строка не найдена в shell.mjs"
        echo "Возможно, версия carbonio-admin-ui изменилась после обновления пакета."
        echo "Проверьте вручную: https://github.com/zextras/carbonio-admin-ui"
        exit 1
    fi

    echo "Создаю бэкап: ${SHELL_MJS}${BACKUP_SUFFIX}"
    cp "$SHELL_MJS" "${SHELL_MJS}${BACKUP_SUFFIX}"

    echo "Применяю патч..."
    if command -v python3 &>/dev/null; then
        echo "Использую python3"
        python3 - "$SHELL_MJS" "$OLD_STR" "$NEW_STR" <<'PYEOF'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()
if old not in content:
    print("ERROR: строка не найдена в файле")
    sys.exit(1)
count = content.count(old)
if count > 1:
    print(f"ERROR: найдено {count} вхождений (ожидалось 1)")
    sys.exit(1)
content = content.replace(old, new, 1)
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("OK")
PYEOF
    elif command -v node &>/dev/null; then
        echo "python3 не найден, использую node"
        node -e "
const fs = require('fs');
const [path, old, newStr] = process.argv.slice(1);
let content = fs.readFileSync(path, 'utf8');
if (!content.includes(old)) { console.error('ERROR: строка не найдена в файле'); process.exit(1); }
const count = content.split(old).length - 1;
if (count > 1) { console.error('ERROR: найдено ' + count + ' вхождений (ожидалось 1)'); process.exit(1); }
fs.writeFileSync(path, content.replace(old, newStr));
console.log('OK');
" "$SHELL_MJS" "$OLD_STR" "$NEW_STR"
    else
        echo "ERROR: не найден ни python3, ни node — невозможно применить патч"
        cp "${SHELL_MJS}${BACKUP_SUFFIX}" "$SHELL_MJS"
        exit 1
    fi

    if [ $? -eq 0 ]; then
        echo "Патч успешно применён."
        echo "Попросите пользователей обновить страницу в браузере (Ctrl+Shift+R)."
    else
        echo "ОШИБКА при применении патча. Восстанавливаю бэкап..."
        cp "${SHELL_MJS}${BACKUP_SUFFIX}" "$SHELL_MJS"
        exit 1
    fi
}

revert_patch() {
    BACKUP=$(ls "${SHELL_MJS}".bak_quota_* 2>/dev/null | sort | tail -1)
    if [ -z "$BACKUP" ]; then
        echo "ERROR: бэкап не найден (${SHELL_MJS}.bak_quota_*)"
        exit 1
    fi
    echo "Восстанавливаю из: $BACKUP"
    cp "$BACKUP" "$SHELL_MJS"
    echo "Готово. Версия восстановлена."
}

case "${1:-}" in
    --check)  check_status ;;
    --revert) revert_patch ;;
    *)        apply_patch ;;
esac
