package ru.cu.carbonio.quota;

import com.zimbra.common.util.EmailUtil;
import com.zimbra.common.util.StringUtil;
import com.zimbra.common.util.ZimbraLog;
import com.zimbra.cs.account.Account;
import com.zimbra.cs.account.Provisioning;
import com.zimbra.cs.ldap.LdapDateUtil;
import com.zimbra.cs.lmtpserver.LmtpCallback;
import com.zimbra.cs.mailbox.DeliveryOptions;
import com.zimbra.cs.mailbox.Flag;
import com.zimbra.cs.mailbox.Mailbox;
import com.zimbra.cs.mailbox.Message;
import com.zimbra.cs.mime.ParsedMessage;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import javax.mail.internet.MailDateFormat;

/**
 * Письмо-предупреждение о заполнении ящика — как QuotaWarning appserver 4.27 (удалён в 4.36).
 * Шаблон — zimbraQuotaWarnMessage (COS), порог zimbraQuotaWarnPercent, интервал zimbraQuotaWarnInterval,
 * отметка zimbraQuotaLastWarnTime. Отличие от 4.27: доставка предупреждения идёт в обход квоты.
 */
public final class CuQuotaWarning implements LmtpCallback {

    private static final CuQuotaWarning INSTANCE = new CuQuotaWarning();

    private CuQuotaWarning() {
    }

    public static CuQuotaWarning getInstance() {
        return INSTANCE;
    }

    @Override
    public void afterDelivery(Account account, Mailbox mbox, String envelopeSender, String recipientEmail, Message newMessage) {
        try {
            int warnPercent = account.getIntAttr("zimbraQuotaWarnPercent", 90);
            long quota = CuQuotaCheck.effectiveQuota(account);
            long warnInterval = account.getTimeInterval("zimbraQuotaWarnInterval", 86400000L);
            String template = account.getAttr("zimbraQuotaWarnMessage", null);
            Date lastWarnTime = account.getGeneralizedTimeAttr("zimbraQuotaLastWarnTime", null);
            Date now = new Date();
            long size = mbox.getSize();
            if (quota == 0L || warnPercent == 0) {
                return;
            }
            if (size * 100L / quota < warnPercent) {
                return;
            }
            if (lastWarnTime != null && now.getTime() - lastWarnTime.getTime() < warnInterval) {
                return;
            }
            if (template == null) {
                ZimbraLog.lmtp.warn("%s not specified. Unable to send quota warning message.", "zimbraQuotaWarnMessage");
                return;
            }
            ZimbraLog.lmtp.info("Sending quota warning: mbox size=%d, quota=%d, lastWarnTime=%s, warnInterval=%dms, warnPercent=%d",
                    size, quota, lastWarnTime, warnInterval, warnPercent);
            String address = account.getAttr("zimbraMailDeliveryAddress");
            String domain = EmailUtil.getLocalPartAndDomain(address)[1];
            Map<String, Object> vars = new HashMap<>();
            vars.put("RECIPIENT_NAME", account.getAttr("displayName"));
            vars.put("RECIPIENT_DOMAIN", domain);
            vars.put("RECIPIENT_ADDRESS", address);
            vars.put("DATE", new MailDateFormat().format(now));
            vars.put("MBOX_SIZE_MB", String.format("%.2f", size / 1024.0 / 1024.0));
            vars.put("QUOTA_MB", String.format("%.2f", quota / 1024.0 / 1024.0));
            vars.put("WARN_PERCENT", warnPercent);
            vars.put("NEWLINE", "\r\n");
            String msgBody = StringUtil.fillTemplate(template, vars);
            ParsedMessage pm = new ParsedMessage(msgBody.getBytes("UTF-8"), now.getTime(), false);
            DeliveryOptions dopt = new DeliveryOptions().setFolderId(Mailbox.ID_FOLDER_INBOX)
                    .setFlags(Flag.BITMASK_UNREAD | Flag.BITMASK_HIGH_PRIORITY);
            CuQuotaCheck.BYPASS.set(Boolean.TRUE);
            try {
                mbox.addMessage(null, pm, dopt, null);
            } finally {
                CuQuotaCheck.BYPASS.set(Boolean.FALSE);
            }
            Map<String, Object> attrs = new HashMap<>();
            attrs.put("zimbraQuotaLastWarnTime", LdapDateUtil.toGeneralizedTime(now));
            Provisioning.getInstance().modifyAttrs(account, attrs);
        } catch (Exception e) {
            ZimbraLog.lmtp.warn("Unable to send quota warning message", e);
        }
    }

    @Override
    public void forwardWithoutDelivery(Account account, Mailbox mbox, String envelopeSender, String recipientEmail, ParsedMessage pm) {
    }
}
