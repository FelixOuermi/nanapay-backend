import nodemailer from "nodemailer";
import { env } from "@config/env";
import { logger } from "@config/logger";

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
});

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

// L'echec d'envoi d'un email ne doit jamais faire echouer l'operation metier qui l'a
// declenche (approbation de compte, penalite, etc.) : l'etat en base est deja la source
// de verite. L'erreur est donc journalisee ici plutot que propagee a l'appelant.
async function sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
  try {
    await transporter.sendMail({ from: env.SMTP_FROM, to, subject, html });
  } catch (error) {
    logger.error("Echec envoi email", { to, subject, error });
  }
}

/** Envoye automatiquement apres validation Admin d'un compte Client ou Commercant. */
export async function sendAccountApprovedEmail(to: string, temporaryPassword: string): Promise<void> {
  await sendEmail({
    to,
    subject: "Votre compte NanaPay a ete valide",
    html: `<p>Votre compte NanaPay a ete valide.</p><p>Identifiant : ${to}<br/>Mot de passe temporaire : ${temporaryPassword}</p><p>Merci de le changer des votre premiere connexion.</p>`,
  });
}

export async function sendAccountRejectedEmail(to: string, reason?: string): Promise<void> {
  await sendEmail({
    to,
    subject: "Votre dossier NanaPay n'a pas ete valide",
    html: `<p>Votre dossier n'a pas ete valide.</p>${reason ? `<p>Motif : ${reason}</p>` : ""}`,
  });
}

/** Envoye lors d'une recuperation de compte (nouveau mot de passe temporaire genere). */
export async function sendPasswordResetEmail(to: string, temporaryPassword: string): Promise<void> {
  await sendEmail({
    to,
    subject: "Reinitialisation de votre mot de passe NanaPay",
    html: `<p>Un nouveau mot de passe temporaire a ete genere pour votre compte.</p><p>Mot de passe temporaire : ${temporaryPassword}</p><p>Merci de le changer des votre prochaine connexion.</p>`,
  });
}

export async function sendGenericNotificationEmail(to: string, subject: string, message: string): Promise<void> {
  await sendEmail({ to, subject, html: `<p>${message}</p>` });
}
