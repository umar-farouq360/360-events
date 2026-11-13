import { createTransport } from 'nodemailer';
export class SmtpEmailProvider {
    transporter;
    allowedDomains;
    isProduction;
    constructor(connectionUrl, isProduction, allowedDomains = []) {
        this.transporter = createTransport(connectionUrl);
        this.isProduction = isProduction;
        this.allowedDomains = allowedDomains;
    }
    isAddressAllowed(email) {
        if (this.isProduction)
            return true;
        const domain = email.split('@')[1];
        return domain !== undefined && this.allowedDomains.includes(domain);
    }
    async sendEmail(payload) {
        if (!this.isAddressAllowed(payload.to)) {
            console.warn(`[Email Guard] Blocked dispatch to ${payload.to} in non-production environment.`);
            return { messageId: 'blocked-by-guard' };
        }
        try {
            const info = await this.transporter.sendMail({
                from: process.env.EMAIL_SENDER ?? 'noreply@360events.ng',
                to: payload.to,
                subject: payload.subject,
                text: payload.textBody,
                html: payload.htmlBody,
            });
            return { messageId: info.messageId };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown SMTP error';
            return { error: errorMessage };
        }
    }
}
