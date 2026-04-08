// server/controllers/voiceController.js
// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR: audio → STT → OpenRouter intent → Google API action → TTS → response
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const { transcribeAudio, synthesizeSpeech } = require("../services/audioService");
const { classifyIntent } = require("../services/openRouterService");
const { sendEmail, fetchLatestEmail, listLatestEmails, replyToEmail, findEmailByName } = require("../services/gmailService");
const { insertEvent } = require("../services/calendarService");
const { createDocument, updateDocumentByTitle } = require("../services/googleDocsService");
const { createSpreadsheet, addRowsByTitle } = require("../services/googleSheetsService");
const { searchYouTube } = require("../services/youtubeService");
const { isAuthenticated, DEFAULT_USER_KEY } = require("../config/googleAuth");

// ── transcribeAudioRequest ──────────────────────────────────────────────────
/**
 * POST /api/transcribe
 * Expects: multipart/form-data with field "audio"
 * Returns: JSON { transcript }
 */
async function transcribeAudioRequest(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No audio file provided. Send multipart/form-data with field "audio".',
      });
    }

    const audioBuffer = req.file.buffer;
    const mimeType = req.file.mimetype || "audio/webm";

    console.log(`[voiceController] Transcribe Audio received — ${audioBuffer.length} bytes, mime: ${mimeType}`);

    let transcript;
    try {
      transcript = await transcribeAudio(audioBuffer, mimeType);
    } catch (sttErr) {
      console.error("[voiceController] STT failed:", sttErr.message);
      return res.status(502).json({ error: `Speech recognition failed: ${sttErr.message}` });
    }

    if (!transcript || transcript.trim().length < 2) {
      return res.status(400).json({
        error: "Could not understand the audio. Please speak clearly and try again.",
        transcript: transcript || "",
      });
    }

    return res.status(200).json({ transcript });
  } catch (unexpectedErr) {
    console.error("[voiceController] Transcribe unexpected error:", unexpectedErr);
    return res.status(500).json({
      error: "An unexpected server error occurred during transcription.",
    });
  }
}

// ── executeCommandRequest ───────────────────────────────────────────────────
/**
 * POST /api/execute
 * Expects: JSON { transcript: "...", timezone: "..." }
 * Returns: JSON { transcript, intent, data, assistant_reply, action_result, audio_base64 }
 */
async function executeCommandRequest(req, res) {
  try {
    const userKey = DEFAULT_USER_KEY;
    const { transcript, timezone } = req.body;
    const userTimezone = timezone || "UTC";

    if (!transcript || transcript.trim().length === 0) {
      return res.status(400).json({ error: "No transcript provided." });
    }

    console.log(`[voiceController] Execute Command — Transcript: "${transcript}"`);

    // ── 1. Intent Classification (OpenRouter) ──────────────────────────────
    let intentResult;
    try {
      intentResult = await classifyIntent(transcript, userTimezone);
    } catch (llmErr) {
      console.error("[voiceController] LLM classification failed:", llmErr.message);
      return res.status(502).json({ error: `AI processing failed: ${llmErr.message}` });
    }

    const { intent, data, assistant_reply: rawReply, missing_info } = intentResult;
    console.log(`[voiceController] Intent: ${intent}`, data);

    // ── 2. Execute Google API Action ───────────────────────────────────────
    let actionResult = null;
    let finalReply = rawReply;

    if (!isAuthenticated(userKey)) {
      finalReply = "I understood your request, but your Google account isn't connected yet. Please authenticate first using the Connect button.";
    } else {
      try {
        switch (intent) {
          // ── WRITE_EMAIL ──────────────────────────────────────────────────
          case "WRITE_EMAIL": {
            if (!data.recipient_name && !data.recipient_email) {
              finalReply = "I couldn't determine who to send this email to. Please specify the recipient's name or email address.";
              break;
            }

            let recipientEmail = data.recipient_email;
            if (!recipientEmail && data.recipient_name) {
              recipientEmail = await findEmailByName(data.recipient_name, userKey);
              if (!recipientEmail) {
                finalReply = `I couldn't find an email address for ${data.recipient_name}. Please provide their email address directly.`;
                break;
              }
            }

            actionResult = await sendEmail(
              {
                recipientName: data.recipient_name,
                recipientEmail,
                subject: data.subject || "No Subject",
                message: data.message || rawReply,
              },
              userKey,
            );

            finalReply = rawReply || `Your email to ${data.recipient_name || recipientEmail} has been sent successfully.`;
            break;
          }

          // ── REPLY_EMAIL ──────────────────────────────────────────────────
          case "REPLY_EMAIL": {
            // Step 1: Identification phase - user hasn't picked an email yet
            if (!data.message && !data.email_index && !data.thread_id && !transcript.toLowerCase().includes("saying")) {
              const emails = await listLatestEmails(userKey, 5);
              actionResult = { emails };
              const subjects = emails.map((e, i) => `${i + 1}. From ${e.from}: ${e.subject}`).join("\n");
              finalReply = `${rawReply || "Sure, which email would you like to reply to?"}\n\nRecent Emails:\n${subjects}\n\nYou can say "the first one" or "the one from [Name]".`;
              break;
            }

            // Step 2: Confirmation phase - user picked an email but didn't say what to say
            if (!data.message) {
              finalReply = rawReply || "What would you like your reply to say?";
              break;
            }

            // Step 3: Execution phase
            let targetEmail;
            try {
              if (data.email_index) {
                const emails = await listLatestEmails(userKey, data.email_index);
                targetEmail = emails[data.email_index - 1];
              } else {
                targetEmail = await fetchLatestEmail(userKey);
              }
            } catch (fetchErr) {
              finalReply = `I couldn't find the email to reply to: ${fetchErr.message}`;
              break;
            }

            actionResult = await replyToEmail(
              {
                threadId: targetEmail.threadId,
                originalFrom: targetEmail.from,
                originalSubject: targetEmail.subject,
                originalMsgId: targetEmail.messageId,
                replyBody: data.message,
              },
              userKey,
            );

            finalReply = rawReply || `Your reply to ${targetEmail.from} has been sent successfully.`;
            break;
          }

          // ── LIST_EMAILS ──────────────────────────────────────────────────
          case "LIST_EMAILS": {
            const emails = await listLatestEmails(userKey, 5);
            actionResult = { emails };
            if (emails.length === 0) {
              finalReply = "Your inbox is empty.";
            } else {
              const count = emails.length;
              const subjects = emails.map((e, i) => `${i + 1}. From ${e.from}: ${e.subject}`).join("\n");
              const responsePrefix = rawReply || `I found your ${count} most recent emails.`;
              finalReply = `${responsePrefix}\n\nRecent Emails:\n${subjects}\n\nWhich one should I handle?`;
            }
            break;
          }

          // ── CREATE_EVENT ─────────────────────────────────────────────────
          case "CREATE_EVENT": {
            if (!data.iso_start_datetime) {
              finalReply = "I need to know when you'd like to schedule this event. Please provide a date and time.";
              break;
            }

            const eventTitle = data.event_title || data.subject || "New Event";

            const finalAttendees = [...(data.attendees || [])];
            if (data.attendee_names && data.attendee_names.length > 0) {
              for (const name of data.attendee_names) {
                const foundEmail = await findEmailByName(name, userKey);
                if (foundEmail) {
                  finalAttendees.push(foundEmail);
                } else {
                  console.warn(`[voiceController] Could not find email for attendee: ${name}`);
                }
              }
            }

            actionResult = await insertEvent(
              {
                title: eventTitle,
                iso_start_datetime: data.iso_start_datetime,
                iso_end_datetime: data.iso_end_datetime,
                description: data.message || "",
                location: data.location || "",
                attendees: finalAttendees,
              },
              userKey,
            );

            finalReply = rawReply || `Your event "${eventTitle}" has been created successfully.`;
            break;
          }

          // ── CREATE_DOC ──────────────────────────────────────────────────
          case "CREATE_DOC": {
            if (!data.doc_title) {
              finalReply = "I need a title for the new document. What should I call it?";
              break;
            }
            actionResult = await createDocument(data.doc_title, userKey);
            finalReply = rawReply || `I've created the document "${data.doc_title}" for you.`;
            break;
          }

          // ── UPDATE_DOC ──────────────────────────────────────────────────
          case "UPDATE_DOC": {
            if (!data.doc_title || !data.doc_content) {
              finalReply = "I need to know which document to update and what content to add.";
              break;
            }
            actionResult = await updateDocumentByTitle(data.doc_title, data.doc_content, userKey);
            finalReply = rawReply || `I've added the content to your document "${data.doc_title}".`;
            break;
          }

          // ── CREATE_SHEET ─────────────────────────────────────────────────
          case "CREATE_SHEET": {
            if (!data.sheet_title) {
              finalReply = "I need a title for the spreadsheet. What should we name it?";
              break;
            }
            actionResult = await createSpreadsheet(data.sheet_title, userKey);
            finalReply = rawReply || `I've created the spreadsheet "${data.sheet_title}" for you.`;
            break;
          }

          // ── UPDATE_SHEET ─────────────────────────────────────────────────
          case "UPDATE_SHEET": {
            if (!data.sheet_title || !data.sheet_row_data) {
              finalReply = "I need the spreadsheet name and the row data you want to add.";
              break;
            }
            actionResult = await addRowsByTitle(data.sheet_title, data.sheet_row_data, "Sheet1!A1", userKey);
            finalReply = rawReply || `I've added the new row to "${data.sheet_title}".`;
            break;
          }

          // ── SEARCH_YOUTUBE ───────────────────────────────────────────────
          case "SEARCH_YOUTUBE": {
            if (!data.search_query) {
              finalReply = "What would you like me to search for on YouTube?";
              break;
            }
            const videos = await searchYouTube(data.search_query, userKey);
            actionResult = { videos };
            if (videos.length > 0) {
              finalReply = rawReply || `I found some videos for "${data.search_query}". The top one is "${videos[0].title}".`;
            } else {
              finalReply = `I couldn't find any YouTube videos for "${data.search_query}".`;
            }
            break;
          }

          // ── INCOMPLETE ───────────────────────────────────────────────────
          case "INCOMPLETE": {
            finalReply = missing_info
              ? `I need a bit more information: ${missing_info}`
              : rawReply || "I need more information to complete that request. Could you provide more details?";
            break;
          }

          // ── UNKNOWN ──────────────────────────────────────────────────────
          case "UNKNOWN":
          default: {
            finalReply =
              rawReply || "I'm sorry, I didn't quite understand that. You can ask me to manage emails, calendar, docs, sheets, or search YouTube.";
            break;
          }
        }
      } catch (actionErr) {
        console.error(`[voiceController] Action "${intent}" failed:`, actionErr.message);
        finalReply = `I understood your request, but encountered an error: ${actionErr.message}`;
      }
    }

    // ── 3. Text-to-Speech ──────────────────────────────────────────────────
    let audioBase64 = null;
    try {
      const ttsBuffer = await synthesizeSpeech(finalReply);
      audioBase64 = ttsBuffer.toString("base64");
    } catch (ttsErr) {
      console.warn("[voiceController] TTS failed (non-fatal):", ttsErr.message);
    }

    // ── 4. Send Response ───────────────────────────────────────────────────
    return res.status(200).json({
      transcript,
      intent,
      data,
      assistant_reply: finalReply,
      action_result: actionResult,
      audio_base64: audioBase64,
      audio_mime_type: "audio/mpeg",
    });
  } catch (unexpectedErr) {
    console.error("[voiceController] Execute unexpected error:", unexpectedErr);
    return res.status(500).json({
      error: "An unexpected server error occurred during execution.",
    });
  }
}

// ── getStatus ──────────────────────────────────────────────────────────────────
/**
 * GET /api/status
 * Returns authentication status and basic system info.
 */
async function getStatus(req, res) {
  try {
    const { isAuthenticated: isAuth, getStoredUserInfo } = require("../config/googleAuth");
    const authenticated = isAuth(DEFAULT_USER_KEY);
    const userInfo = getStoredUserInfo(DEFAULT_USER_KEY);

    return res.status(200).json({
      authenticated,
      user: userInfo,
      services: {
        openrouter: !!process.env.OPENROUTER_API_KEY,
        openai_whisper: !!process.env.OPENAI_API_KEY,
        google_oauth: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { transcribeAudioRequest, executeCommandRequest, getStatus };
