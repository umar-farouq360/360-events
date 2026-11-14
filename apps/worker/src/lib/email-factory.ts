import { SmtpEmailProvider, type EmailProvider } from './email.js';

export interface EmailFactoryEnv {
  NODE_ENV: string;
  EMAIL_SMTP_URL?: string;
  EMAIL_ALLOWED_DOMAINS?: string;
  EMAIL_SENDER?: string;
}

/** Default mail-catcher URL used in development/test (MailHog / Mailpit default port). */
const DEV_SMTP_URL = 'smtp://localhost:1025';

/** Default domain guard in non-production; matches the notification-handler tests. */
const DEFAULT_ALLOWED_DOMAINS = ['360events.ng'];

export function createEmailProvider(env: EmailFactoryEnv): EmailProvider {
  const isProduction = env.NODE_ENV === 'production';
  const isStaging = env.NODE_ENV === 'staging';

  const smtpUrl = env.EMAIL_SMTP_URL ?? (isProduction || isStaging ? undefined : DEV_SMTP_URL);

  if (!smtpUrl) {
    throw new Error(
      `EMAIL_SMTP_URL is required in ${env.NODE_ENV}. ` +
      `Refusing to start the worker without an email transport.`,
    );
  }

  const allowedDomains = env.EMAIL_ALLOWED_DOMAINS
    ? env.EMAIL_ALLOWED_DOMAINS.split(',').map((d) => d.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_DOMAINS;

  // EMAIL_SENDER is read by SmtpEmailProvider itself; thread it through the process
  // env so the provider sees the same value the factory validated.
  if (env.EMAIL_SENDER) process.env.EMAIL_SENDER = env.EMAIL_SENDER;

  return new SmtpEmailProvider(smtpUrl, isProduction, allowedDomains);
}