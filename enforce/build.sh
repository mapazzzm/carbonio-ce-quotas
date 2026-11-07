#!/bin/bash
# Сборка cu-quota-enforce.jar против jar установленного appserver Carbonio (нужен JDK из /opt/zextras).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
JDK=/opt/zextras/common/lib/jvm/java/bin
CP="/opt/zextras/mailbox/jars/*:/opt/zextras/lib/jars/*"
OUT="$HERE/build"
rm -rf "$OUT"; mkdir -p "$OUT/classes"
"$JDK/javac" -nowarn --release 21 -cp "$CP" -d "$OUT/classes" $(find "$HERE/src" -name '*.java')
printf 'Manifest-Version: 1.0\nZimbra-Extension-Class: ru.cu.carbonio.quota.CuQuotaExtension\n' > "$OUT/MANIFEST.MF"
"$JDK/jar" cfm "$OUT/cu-quota-enforce.jar" "$OUT/MANIFEST.MF" -C "$OUT/classes" .
echo "built: $OUT/cu-quota-enforce.jar"
