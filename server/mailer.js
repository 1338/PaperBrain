import nodemailer from 'nodemailer';
import { decryptSecret, getSetting } from './settings.js';

async function smtpConfiguration() {
  const smtp = await getSetting('smtp');
  if (!smtp?.host || !smtp?.from) throw new Error('SMTP is not configured.');
  return smtp;
}

export async function sendEmail({ to, subject, text, html }) {
  const smtp = await smtpConfiguration();
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port || 587),
    secure: Boolean(smtp.secure),
    auth: smtp.user ? { user: smtp.user, pass: decryptSecret(smtp.encryptedPassword) } : undefined
  });
  return transporter.sendMail({ from: smtp.from, to, subject, text, html });
}

export async function sendVerificationEmail(user, verificationUrl) {
  return sendEmail({
    to: user.email,
    subject: 'Verify your PaperBrain email',
    text: `Verify your PaperBrain account: ${verificationUrl}`,
    html: `<p>Welcome to PaperBrain.</p><p><a href="${verificationUrl}">Verify your email address</a></p><p>This link expires in 24 hours.</p>`
  });
}
