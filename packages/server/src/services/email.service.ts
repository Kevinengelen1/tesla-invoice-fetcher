import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logStream } from './log-stream.service.js';
import type { Invoice } from '../types/models.js';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!config.email.enabled) return null;
  if (!config.email.smtpHost) return null;

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.email.smtpHost,
      port: config.email.smtpPort,
      secure: config.email.smtpSecure,
      auth: config.email.smtpUser ? {
        user: config.email.smtpUser,
        pass: config.email.smtpPass,
      } : undefined,
    });
  }
  return transporter;
}

export async function sendInvoiceNotification(newInvoices: Invoice[]) {
  const transport = getTransporter();
  if (!transport || newInvoices.length === 0) return;

  const invoiceLines = newInvoices.map(inv => {
    const amount = inv.amount_cents != null ? `${inv.currency} ${(inv.amount_cents / 100).toFixed(2)}` : 'N/A';
    return `- ${inv.invoice_date} | ${inv.invoice_type} | ${inv.site_name ?? 'N/A'} | ${amount}`;
  }).join('\n');

  try {
    await transport.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject: `Tesla Invoice Fetcher: ${newInvoices.length} new invoice(s)`,
      text: `New invoices fetched:\n\n${invoiceLines}\n\nView details in the dashboard.`,
      html: `
        <h2>New Tesla Invoices</h2>
        <p>${newInvoices.length} new invoice(s) fetched:</p>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
          <tr><th>Date</th><th>Type</th><th>Location</th><th>Amount</th></tr>
          ${newInvoices.map(inv => {
            const amount = inv.amount_cents != null ? `${inv.currency} ${(inv.amount_cents / 100).toFixed(2)}` : 'N/A';
            return `<tr><td>${inv.invoice_date}</td><td>${inv.invoice_type}</td><td>${inv.site_name ?? 'N/A'}</td><td>${amount}</td></tr>`;
          }).join('')}
        </table>
      `,
    });
    logStream.info(`Invoice notification email sent to ${config.email.to}`);
  } catch (err) {
    logStream.error('Failed to send invoice notification email', { error: String(err) });
  }
}

export async function sendTestEmail(): Promise<boolean> {
  const transport = getTransporter();
  if (!transport) {
    throw new Error('Email is not configured');
  }

  await transport.sendMail({
    from: config.email.from,
    to: config.email.to,
    subject: 'Tesla Invoice Fetcher - Test Email',
    text: 'This is a test email from Tesla Invoice Fetcher. If you received this, email is configured correctly.',
  });

  return true;
}

export function resetTransporter() {
  transporter = null;
}
