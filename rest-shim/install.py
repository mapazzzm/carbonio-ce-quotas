#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""carbonio-ce-quotas / rest-shim — квоты в админке Carbonio CE 0.20.x (эмуляция REST Storages).

RU: admin-console-ui 0.20.x управляет квотами через REST /services/storages/admin/quota/*,
    которого в CE нет (403 «RBAC: access denied») — экраны квот учётки, домена и COS не
    работают, хотя сами квоты (LDAP) сервер соблюдает. Скрипт встраивает в shell.mjs слой
    quota-rest-shim.js: перехват fetch к этим адресам → admin SOAP (GetAccount/ModifyAccount,
    GetCos/ModifyCos, GetDomain/ModifyDomain, GetMailbox, GetQuotaUsage). Кнопка «Скачать
    отчёт по квотам» домена → CSV из GetQuotaUsage.
EN: admin-console-ui 0.20.x manages quotas via the Storages REST API, absent in CE (403). This
    injects a fetch shim that serves those endpoints from the admin SOAP API (LDAP quotas).

Не зависит от минифицированных имён (кроме регулярки кнопки отчёта) — переживает пересборки.
Повторный запуск снимает прошлую вставку и ставит текущую (обновление поверх установленного).

    python3 install.py [install|check|uninstall]
"""
import glob, json, os, re, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
SHELL = os.environ.get("ADMIN_SHELL", "/opt/zextras/admin/iris/carbonio-admin-ui/shell.mjs")
SHIM = os.path.join(HERE, "quota-rest-shim.js")
BEGIN, END = "/*__cuQuotaShim:begin*/", "/*__cuQuotaShim:end*/"
REPORT_RX = re.compile(r'globalThis\.location\.href=`\$\{([\w$]+)\}/quota/domain/report/\$\{([\w$]+)\}`')
REPORT_DONE = re.compile(r'window\.__cuQ\?window\.__cuQ\.report\(([\w$]+)\):(globalThis\.location\.href=`\$\{[\w$]+\}/quota/domain/report/\$\{[\w$]+\}`)')


def log(m): print(">> " + m)


def unlock_sets(legacy=False):
    """Пары «показать экраны квот без carbonio-advanced» — по файлу на сборку (unlock_<ver>.json).
    legacy=True добавляет прежние варианты пар (ключ "legacy") — только для отката при обновлении."""
    out = []
    for f in sorted(glob.glob(os.path.join(HERE, "unlock_*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        out.append(d["pairs"])
        if legacy and d.get("legacy"):
            out.append(d["legacy"])
    return out


def pick_unlock(s):
    """Набор, все orig/patched которого найдены в файле (orig ровно 1 раз или уже patched)."""
    for pairs in unlock_sets():
        if all(s.count(o) == 1 or (o not in s and p in s) for _, o, p in pairs):
            return pairs
    return None


def strip(s):
    i, j = s.find(BEGIN), s.find(END)
    if i >= 0 and j > i:
        s = s[:i] + s[j + len(END):]
    for pairs in unlock_sets(legacy=True):
        for _, o, p in pairs:
            if p in s and o not in s:
                s = s.replace(p, o, 1)
    return REPORT_DONE.sub(lambda m: m.group(2), s)


def node_ok(path):
    node = shutil.which("node") or "/opt/zextras/common/bin/node"
    if not os.path.exists(node):
        log("node не найден — пропускаю проверку синтаксиса / skip syntax check")
        return True
    r = subprocess.run([node, "--check", path], capture_output=True, text=True)
    if r.returncode:
        print(r.stderr[:500])
    return r.returncode == 0


def chown_like_dir(p):
    try:
        st = os.stat(os.path.dirname(p)); os.chown(p, st.st_uid, st.st_gid)
    except OSError:
        pass


def uses_rest(s):
    return "/quota/config/accounts/" in s or "/quota/accounts/" in s


def check():
    s = open(SHELL, encoding="utf-8").read()
    print("shell.mjs:", SHELL)
    print("  REST-квоты в сборке / build uses quota REST:", "да" if uses_rest(s) else "нет (shim не нужен)")
    print("  shim:", "УСТАНОВЛЕН" if BEGIN in s else "не установлен")
    up = pick_unlock(s)
    print("  экраны квот без carbonio-advanced / quota screens unlocked:",
          ("%d/%d" % (sum(1 for _, o, p in up if p in s and o not in s), len(up))) if up else "сборка не распознана")
    print("  кнопка отчёта / report button:",
          "перенаправлена" if REPORT_DONE.search(s) else ("штатная" if REPORT_RX.search(s) else "не найдена"))
    return BEGIN in s


def install():
    s = open(SHELL, encoding="utf-8").read()
    if not uses_rest(s):
        log("сборка не использует REST квот — shim не нужен, ничего не меняю"); return 0
    base = strip(s)
    shim = open(SHIM, encoding="utf-8").read().strip()
    new = BEGIN + shim + END + base
    up = pick_unlock(new)
    if up is None:
        log("ВНИМАНИЕ: не найдены места показа экранов квот этой сборки — эмуляция ставится, "
            "но экраны останутся скрыты (нужен unlock_<версия>.json)")
    else:
        for name, o, p in up:
            new = new.replace(o, p, 1)
        log("экраны квот открыты без carbonio-advanced: %d мест" % len(up))
    new, n = REPORT_RX.subn(lambda m: "window.__cuQ?window.__cuQ.report(%s):%s" % (m.group(2), m.group(0)), new, count=1)
    log("кнопка отчёта: %s" % ("перенаправлена" if n else "не найдена (оставлена как есть)"))
    if new == s:
        log("уже установлен в текущей версии / already up to date"); return 0
    tmp = SHELL + ".tmp_quotashim.mjs"
    open(tmp, "w", encoding="utf-8").write(new)
    if not node_ok(tmp):
        os.remove(tmp); log("ОШИБКА синтаксиса — shell.mjs не изменён"); return 2
    bk = SHELL + ".bak_quotashim_" + time.strftime("%Y%m%d_%H%M%S")
    shutil.copy2(SHELL, bk); log("бэкап: " + bk)
    os.replace(tmp, SHELL); chown_like_dir(SHELL)
    log("shim %s. Обновите админку (Ctrl+F5)." % ("обновлён" if BEGIN in s else "установлен"))
    return 0


def uninstall():
    s = open(SHELL, encoding="utf-8").read()
    new = strip(s)
    if new == s:
        log("shim не установлен"); return 0
    tmp = SHELL + ".tmp_quotashim.mjs"
    open(tmp, "w", encoding="utf-8").write(new)
    if not node_ok(tmp):
        os.remove(tmp); log("ОШИБКА синтаксиса"); return 2
    shutil.copy2(SHELL, SHELL + ".bak_quotashim_" + time.strftime("%Y%m%d_%H%M%S"))
    os.replace(tmp, SHELL); chown_like_dir(SHELL); log("shim снят"); return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    sys.exit({"install": install, "uninstall": uninstall}.get(cmd, lambda: (check(), 0)[1])())
