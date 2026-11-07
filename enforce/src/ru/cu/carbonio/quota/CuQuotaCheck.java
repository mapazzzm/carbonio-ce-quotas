package ru.cu.carbonio.quota;

import com.zextras.mailbox.quota.QuotaCheck;
import com.zimbra.common.service.ServiceException;
import com.zimbra.cs.account.Account;
import com.zimbra.cs.account.Domain;
import com.zimbra.cs.account.Provisioning;
import com.zimbra.cs.mailbox.MailServiceException;
import com.zimbra.cs.mailbox.Mailbox;
import com.zimbra.cs.mailbox.MailboxManager;

/**
 * Проверка квоты — как DefaultQuotaCheck в appserver 4.27 (без агрегатной квоты домена: её функции в
 * 4.36 удалены). Действующая квота = меньшее ненулевое из zimbraMailQuota (учётка/COS) и
 * zimbraMailDomainQuota домена — как AccountUtil.getEffectiveQuota 4.27.
 */
public class CuQuotaCheck implements QuotaCheck {

    /** Доставка письма-предупреждения не должна упираться в квоту (иначе в полный ящик оно не дойдёт). */
    static final ThreadLocal<Boolean> BYPASS = ThreadLocal.withInitial(() -> Boolean.FALSE);

    static long effectiveQuota(Account acct) throws ServiceException {
        long acctQuota = acct.getLongAttr("zimbraMailQuota", 0L);
        long domainQuota = 0L;
        Domain domain = Provisioning.getInstance().getDomain(acct);
        if (domain != null) {
            domainQuota = domain.getLongAttr("zimbraMailDomainQuota", 0L);
        }
        if (acctQuota == 0L) {
            return domainQuota;
        }
        if (domainQuota == 0L) {
            return acctQuota;
        }
        return Math.min(acctQuota, domainQuota);
    }

    @Override
    public void onSendMessage(Account account) throws ServiceException {
        if (!account.isMailAllowReceiveButNotSendWhenOverQuota()) {
            return;
        }
        long quota = effectiveQuota(account);
        if (quota == 0L) {
            return;
        }
        Mailbox mbox = MailboxManager.getInstance().getMailboxByAccount(account);
        if (mbox.getSize() > quota) {
            throw MailServiceException.QUOTA_EXCEEDED(quota);
        }
    }

    @Override
    public void onAddMessage(Account acct, long newTotalMailboxUsage) throws ServiceException {
        if (BYPASS.get()) {
            return;
        }
        long quota = effectiveQuota(acct);
        if (quota != 0L && newTotalMailboxUsage > quota) {
            throw MailServiceException.QUOTA_EXCEEDED(quota);
        }
    }

    @Override
    public void onDeleteMessage(Account acct, long size) {
    }
}
