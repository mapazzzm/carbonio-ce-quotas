package ru.cu.carbonio.quota;

import com.zextras.mailbox.quota.QuotaCheck;
import com.zextras.mailbox.quota.QuotaCheckSingleton;
import com.zimbra.common.service.ServiceException;
import com.zimbra.common.util.ZimbraLog;
import com.zimbra.cs.extension.ExtensionException;
import com.zimbra.cs.extension.ZimbraExtension;
import com.zimbra.cs.lmtpserver.ZimbraLmtpBackend;

/**
 * carbonio-ce-quota-enforce — возвращает в Carbonio CE (appserver 4.36+) соблюдение квот ящиков и
 * письма-предупреждения о заполнении.
 *
 * В 4.36 Zextras вынес проверку квоты в подключаемый хук {@link QuotaCheckSingleton}; реализация по
 * умолчанию в CE пустая (в 4.27 она бросала QUOTA_EXCEEDED), класс QuotaWarning удалён, а
 * AccountUtil.getEffectiveQuota возвращает 0. Реальная реализация есть только в carbonio-advanced.
 * Это расширение ставит свою реализацию хука и LMTP-колбэк предупреждения — с логикой 4.27.
 */
public class CuQuotaExtension implements ZimbraExtension {

    @Override
    public String getName() {
        return "cu-quota-enforce";
    }

    @Override
    public void init() throws ExtensionException, ServiceException {
        QuotaCheck previous = QuotaCheckSingleton.getInstance();
        QuotaCheckSingleton.setInstance(new CuQuotaCheck());
        ZimbraLmtpBackend.addCallback(CuQuotaWarning.getInstance());
        ZimbraLog.extensions.info("cu-quota-enforce: quota check installed (replaced %s), quota warning callback registered",
                previous == null ? "null" : previous.getClass().getName());
    }

    @Override
    public void destroy() {
    }
}
