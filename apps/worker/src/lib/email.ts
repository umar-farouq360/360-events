import { createTransport, Transporter } from 'nodemailer';

export interface EmailPayload {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
}

export interface EmailProvider {
  sendEmail(payload: EmailPayload): Promise<{ messageId?: string; error?: string }>;
}

export class SmtpEmailProvider implements EmailProvider {
  private transporter: Transporter;
  private allowedDomains: string[];
  private isProduction: boolean;

  constructor(
    connectionUrl: string, 
    isProduction: boolean, 
    allowedDomains: string[] = []
  ) {
    this.transporter = createTransport(connectionUrl);
    this.isProduction = isProduction;
    this.allowedDomains = allowedDomains;
  }

  private isAddressAllowed(email: string): boolean {
    if (this.isProduction) return true;
    const domain = email.split('@')[1];
    return domain !== undefined && this.allowedDomains.includes(domain);
  }

  async sendEmail(payload: EmailPayload): Promise<{ messageId?: string; error?: string }> {
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown SMTP error';
      return { error: errorMessage };
    }
  }
}