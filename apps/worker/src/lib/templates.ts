export type EmailPart = 'subject' | 'text' | 'html';

// Explicit notification types driven by business requirements
export type NotificationType = 
  | 'VERIFY_EMAIL' 
  | 'PASSWORD_RESET' 
  | 'ORDER_CONFIRMED' 
  | 'EVENT_CANCELLED';

function stringPayloadValue(
  payload: Record<string, unknown>,
  key: string,
  fallback = ''
): string {
  const value = payload[key];
  return typeof value === 'string' ? value : fallback;
}

export function renderTemplate(
  type: string,
  part: EmailPart,
  payload: Record<string, unknown>
): string {
  switch (type as NotificationType) {
    case 'VERIFY_EMAIL':
      return renderVerifyEmail(part, payload);
    case 'PASSWORD_RESET':
      return renderPasswordReset(part, payload);
    case 'ORDER_CONFIRMED':
      return renderOrderConfirmed(part, payload);
    case 'EVENT_CANCELLED':
      return renderEventCancelled(part, payload);
    default:
      return renderFallback(part, type);
  }
}

function renderVerifyEmail(part: EmailPart, payload: Record<string, unknown>): string {
  // baseUrl should ideally be injected via environment variables in production
  const baseUrl = process.env.FRONTEND_URL ?? 'https://app.360events.ng';
  const token = stringPayloadValue(payload, 'token');
  const link = `${baseUrl}/auth/verify-email?token=${encodeURIComponent(token)}`;

  if (part === 'subject') return 'Verify your email address - 360Events';
  if (part === 'text') return `Welcome to 360Events! Please verify your email by visiting: ${link}`;
  
  return `
    <h2>Welcome to 360Events</h2>
    <p>Please verify your email address to complete your registration.</p>
    <p><a href="${link}">Click here to verify your email</a></p>
    <p>If the link does not work, copy and paste this into your browser: <br/> ${link}</p>
  `;
}

function renderPasswordReset(part: EmailPart, payload: Record<string, unknown>): string {
  const baseUrl = process.env.FRONTEND_URL ?? 'https://app.360events.ng';
  const token = stringPayloadValue(payload, 'token');
  const link = `${baseUrl}/auth/reset-password?token=${encodeURIComponent(token)}`;

  if (part === 'subject') return 'Reset your password - 360Events';
  if (part === 'text') return `You requested a password reset. Reset your password by visiting: ${link}`;
  
  return `
    <h2>Password Reset Request</h2>
    <p>You recently requested to reset your password for your 360Events account.</p>
    <p><a href="${link}">Click here to reset your password</a></p>
    <p>If you did not request this, please ignore this email.</p>
  `;
}

function renderOrderConfirmed(part: EmailPart, payload: Record<string, unknown>): string {
  const orderId = stringPayloadValue(payload, 'orderId', 'Unknown');
  if (part === 'subject') return `Order Confirmed: #${orderId} - 360Events`;
  if (part === 'text') return `Your order #${orderId} is confirmed. Log in to view your tickets.`;
  return `
    <h2>Order Confirmed</h2>
    <p>Thank you for your purchase! Your order <strong>#${orderId}</strong> has been successfully processed.</p>
    <p>Please log in to your account dashboard to view and download your tickets.</p>
  `;
}

function renderEventCancelled(part: EmailPart, payload: Record<string, unknown>): string {
  const eventName = stringPayloadValue(payload, 'eventName', 'An event you booked');
  if (part === 'subject') return `Important Update: ${eventName} has been cancelled`;
  if (part === 'text') return `${eventName} has been cancelled. A refund has been initiated to your original payment method.`;
  return `
    <h2>Event Cancellation Notice</h2>
    <p>We are writing to inform you that <strong>${eventName}</strong> has been cancelled by the organizer.</p>
    <p>A refund workflow has been initiated. If you are eligible, the funds will be returned to your original payment method in accordance with our refund policy.</p>
  `;
}

function renderFallback(part: EmailPart, type: string): string {
  if (part === 'subject') return `Notification: ${type}`;
  if (part === 'text') return `You have a new system notification (${type}). Log in to your dashboard to view it.`;
  return `
    <h2>System Notification</h2>
    <p>You have a new notification of type <strong>${type}</strong>.</p>
    <p>Please log in to your 360Events account for more details.</p>
  `;
}