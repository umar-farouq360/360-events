export interface EmailPayload {
    to: string;
    subject: string;
    textBody: string;
    htmlBody?: string;
}
export interface EmailProvider {
    sendEmail(payload: EmailPayload): Promise<{
        messageId?: string;
        error?: string;
    }>;
}
export declare class SmtpEmailProvider implements EmailProvider {
    private transporter;
    private allowedDomains;
    private isProduction;
    constructor(connectionUrl: string, isProduction: boolean, allowedDomains?: string[]);
    private isAddressAllowed;
    sendEmail(payload: EmailPayload): Promise<{
        messageId?: string;
        error?: string;
    }>;
}
