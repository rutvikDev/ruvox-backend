// server/services/gmailService.js
// ─────────────────────────────────────────────────────────────────────────────
// Gmail operations: send new email, fetch latest thread, reply to thread.
// Uses googleapis with full OAuth2 token refresh support.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const { google } = require('googleapis');
const { getAuthenticatedClient } = require('../config/googleAuth');

// ── Helper: Encode email as RFC 2822 base64url ────────────────────────────────
function encodeEmail({ from, to, subject, body, inReplyTo, references, threadId }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
  ];

  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);

  lines.push('', body);

  const raw = lines.join('\r\n');

  // base64url encode (URL-safe, no padding)
  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ── Get Authenticated Gmail Client ────────────────────────────────────────────
function getGmailClient(userKey) {
  const auth = getAuthenticatedClient(userKey);
  return google.gmail({ version: 'v1', auth });
}

// ── Get Current User's Email Address ─────────────────────────────────────────
async function getSenderEmail(gmail) {
  const { data } = await gmail.users.getProfile({ userId: 'me' });
  return data.emailAddress;
}

// ── Send New Email ────────────────────────────────────────────────────────────
/**
 * @param {object} params
 * @param {string} params.recipientName   - Display name of recipient.
 * @param {string} params.recipientEmail  - Recipient's email address.
 * @param {string} params.subject         - Email subject line.
 * @param {string} params.message         - Plain-text body of the email.
 * @param {string} [userKey]              - OAuth user key (default user).
 * @returns {Promise<{messageId: string, threadId: string}>}
 */
async function sendEmail({ recipientName, recipientEmail, subject, message }, userKey) {
  if (!recipientEmail) throw new Error('recipientEmail is required to send an email');
  if (!subject) throw new Error('subject is required to send an email');
  if (!message) throw new Error('message body is required to send an email');

  const gmail = getGmailClient(userKey);
  const senderEmail = await getSenderEmail(gmail);

  const to = recipientName ? `${recipientName} <${recipientEmail}>` : recipientEmail;

  const raw = encodeEmail({
    from: senderEmail,
    to,
    subject,
    body: message,
  });

  const { data } = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  console.log(`[gmailService] Email sent — messageId: ${data.id}, threadId: ${data.threadId}`);
  return { messageId: data.id, threadId: data.threadId };
}

// ── Fetch Latest Message in Inbox ─────────────────────────────────────────────
/**
 * Returns metadata + snippet of the most recent inbox message.
 * @param {string} [userKey]
 * @returns {Promise<{from: string, subject: string, snippet: string, messageId: string, threadId: string}>}
 */
async function fetchLatestEmail(userKey) {
  const gmail = getGmailClient(userKey);

  // List the single most recent inbox message
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    labelIds: ['INBOX'],
    maxResults: 1,
  });

  const messages = listRes.data.messages;
  if (!messages || messages.length === 0) {
    throw new Error('No messages found in inbox');
  }

  const { data: msg } = await gmail.users.messages.get({
    userId: 'me',
    id: messages[0].id,
    format: 'metadata',
    metadataHeaders: ['From', 'Subject', 'Date', 'Message-ID'],
  });

  const headers = {};
  (msg.payload?.headers || []).forEach((h) => {
    headers[h.name.toLowerCase()] = h.value;
  });

  return {
    from: headers['from'] || 'Unknown',
    subject: headers['subject'] || '(No Subject)',
    date: headers['date'] || '',
    messageId: headers['message-id'] || '',
    snippet: msg.snippet || '',
    gmailId: msg.id,
    threadId: msg.threadId,
  };
}

// ── List Latest Messages ──────────────────────────────────────────────────────
/**
 * Returns a list of the most recent inbox messages.
 * @param {string} [userKey]
 * @param {number} [maxResults]
 */
async function listLatestEmails(userKey, maxResults = 5) {
  const gmail = getGmailClient(userKey);

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    labelIds: ['INBOX'],
    maxResults,
  });

  const messages = listRes.data.messages || [];
  const results = [];

  for (const m of messages) {
    const { data: msg } = await gmail.users.messages.get({
      userId: 'me',
      id: m.id,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date', 'Message-ID'],
    });

    const headers = {};
    (msg.payload?.headers || []).forEach((h) => {
      headers[h.name.toLowerCase()] = h.value;
    });

    results.push({
      from: headers['from'] || 'Unknown',
      subject: headers['subject'] || '(No Subject)',
      date: headers['date'] || '',
      snippet: msg.snippet || '',
      gmailId: msg.id,
      threadId: msg.threadId,
      messageId: headers['message-id'] || '',
    });
  }

  return results;
}

// ── Reply to Email Thread ─────────────────────────────────────────────────────
/**
 * Replies to an existing email thread.
 * @param {object} params
 * @param {string} params.threadId        - Gmail thread ID to reply to.
 * @param {string} params.originalFrom    - The From address of the email being replied to.
 * @param {string} params.originalSubject - Subject of the original email.
 * @param {string} params.originalMsgId   - Message-ID header of the original email.
 * @param {string} params.replyBody       - Plain-text body of the reply.
 * @param {string} [userKey]
 * @returns {Promise<{messageId: string, threadId: string}>}
 */
async function replyToEmail(
  { threadId, originalFrom, originalSubject, originalMsgId, replyBody },
  userKey
) {
  if (!threadId) throw new Error('threadId is required to reply to an email');
  if (!replyBody) throw new Error('replyBody is required');

  const gmail = getGmailClient(userKey);
  const senderEmail = await getSenderEmail(gmail);

  // Ensure subject has "Re: " prefix
  const replySubject = originalSubject?.startsWith('Re:')
    ? originalSubject
    : `Re: ${originalSubject || ''}`;

  const raw = encodeEmail({
    from: senderEmail,
    to: originalFrom,
    subject: replySubject,
    body: replyBody,
    inReplyTo: originalMsgId,
    references: originalMsgId,
  });

  const { data } = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw,
      threadId, // critical: keeps the reply in the same thread
    },
  });

  console.log(`[gmailService] Reply sent — threadId: ${data.threadId}`);
  return { messageId: data.id, threadId: data.threadId };
}

// ── Find Recipient Email by Name ──────────────────────────────────────────────
/**
 * Searches Gmail sent/contacts for a matching email address by name.
 * Falls back gracefully if not found.
 * @param {string} recipientName
 * @param {string} [userKey]
 * @returns {Promise<string|null>}
 */
async function findEmailByName(recipientName, userKey) {
  if (!recipientName) return null;

  try {
    const gmail = getGmailClient(userKey);
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: `to:${recipientName} OR from:${recipientName}`,
      maxResults: 5,
    });

    if (!data.messages?.length) return null;

    // Get first message and parse the relevant address
    const { data: msg } = await gmail.users.messages.get({
      userId: 'me',
      id: data.messages[0].id,
      format: 'metadata',
      metadataHeaders: ['To', 'From', 'Cc'],
    });

    const headers = (msg.payload?.headers || []).reduce((acc, h) => {
      acc[h.name.toLowerCase()] = h.value;
      return acc;
    }, {});

    // Try to extract email matching the name from all address fields
    const allAddresses = [headers.to, headers.from, headers.cc]
      .filter(Boolean)
      .join(', ');

    const nameRegex = new RegExp(
      `${recipientName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*<([^>]+)>`,
      'i'
    );
    const match = allAddresses.match(nameRegex);
    return match ? match[1] : null;
  } catch (err) {
    console.warn('[gmailService] findEmailByName failed:', err.message);
    return null;
  }
}

module.exports = {
  sendEmail,
  fetchLatestEmail,
  listLatestEmails,
  replyToEmail,
  findEmailByName,
};