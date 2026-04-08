// server/controllers/workspaceController.js
"use strict";

const { createDocument, updateDocumentByTitle } = require("../services/googleDocsService");
const { createSpreadsheet, addRowsByTitle } = require("../services/googleSheetsService");
const { searchYouTube } = require("../services/youtubeService");
const { listLatestEmails, replyToEmail } = require("../services/gmailService");
const { DEFAULT_USER_KEY } = require("../config/googleAuth");

/**
 * GET /api/workspace/emails/list
 */
async function listEmails(req, res) {
  try {
    const results = await listLatestEmails(DEFAULT_USER_KEY, 5);
    res.json({ emails: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/workspace/emails/reply
 * { threadId, originalFrom, originalSubject, originalMsgId, body }
 */
async function replyToEmailReq(req, res) {
  try {
    const { threadId, originalFrom, originalSubject, originalMsgId, body } = req.body;
    if (!threadId || !body) {
      return res.status(400).json({ error: "threadId and body are required" });
    }

    const result = await replyToEmail(
      { threadId, originalFrom, originalSubject, originalMsgId, replyBody: body },
      DEFAULT_USER_KEY,
    );
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[workspaceController] Reply failed:", err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/docs/create
 * { title: "..." }
 */
async function createDoc(req, res) {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required" });
    const result = await createDocument(title, DEFAULT_USER_KEY);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/sheets/create
 * { title: "..." }
 */
async function createSheet(req, res) {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required" });
    const result = await createSpreadsheet(title, DEFAULT_USER_KEY);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/youtube/search?q=...
 */
async function youtubeSearch(req, res) {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: "Query 'q' is required" });
    const result = await searchYouTube(q, DEFAULT_USER_KEY);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listEmails, replyToEmailReq, createDoc, createSheet, youtubeSearch };
