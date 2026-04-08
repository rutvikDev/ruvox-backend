// server/services/openRouterService.js
// ─────────────────────────────────────────────────────────────────────────────
// Calls the OpenRouter chat completions endpoint with a dynamic system prompt
// that injects current date/time. Returns a strictly validated JSON intent.
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fetch = require("node-fetch");
const { formatISO, parseISO, isValid } = require("date-fns");

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

// ── Intent Schema ─────────────────────────────────────────────────────────────
const VALID_INTENTS = [
  "WRITE_EMAIL",
  "REPLY_EMAIL",
  "CREATE_EVENT",
  "CREATE_DOC",
  "UPDATE_DOC",
  "CREATE_SHEET",
  "UPDATE_SHEET",
  "SEARCH_YOUTUBE",
  "LIST_EMAILS",
  "UNKNOWN",
  "INCOMPLETE",
];

// ── System Prompt Factory ─────────────────────────────────────────────────────
function buildSystemPrompt(userTimezone = "UTC") {
  const now = new Date();
  const currentDate = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: userTimezone,
  });

  return `You are an elite AI assistant. Today is ${currentDate} in ${userTimezone}.
Extract user intent and structured data from the transcribed voice command.
You MUST respond strictly in valid JSON matching this schema:
{
  "intent": "Intent String",
  "missing_info": "String explaining what is missing if intent is INCOMPLETE, otherwise null",
  "data": {
    "recipient_name": "string or null",
    "recipient_email": "string or null",
    "subject": "string or null",
    "message": "string or null",
    "thread_id": "string or null",
    "email_index": "number or null",
    "event_title": "string or null",
    "iso_start_datetime": "ISO 8601 string or null",
    "iso_end_datetime": "ISO 8601 string or null",
    "location": "string or null",
    "attendees": ["email strings"] or [],
    "doc_title": "string or null",
    "doc_content": "string or null",
    "sheet_title": "string or null",
    "sheet_row_data": ["column values"] or [],
    "search_query": "string or null"
  },
  "assistant_reply": "A natural, conversational response to speak back to the user."
}

Intents:
- WRITE_EMAIL / REPLY_EMAIL: If the user wants to reply but hasn't picked a specific email yet, use LIST_EMAILS first. If they specify "the first one" or "about [Subject]", extract that to 'subject' or 'threadId' (if known).
- CREATE_EVENT
- CREATE_DOC
- UPDATE_DOC
- CREATE_SHEET
- UPDATE_SHEET
- SEARCH_YOUTUBE
- LIST_EMAILS: Use this when the user wants to see their latest emails or which email to reply to.

Examples:
- Transcript: "Please reply to the most recent email."
  Response: { "intent": "LIST_EMAILS", "assistant_reply": "Sure, which one would you like to reply to? Here are your latest 5 emails..." }
- Transcript: "The first one"
  Response: { "intent": "REPLY_EMAIL", "data": { "email_index": 1 }, "assistant_reply": "I've selected the first email. What would you like your reply to say?" }
- Transcript: "Tell them I am interested"
  Response: { "intent": "REPLY_EMAIL", "data": { "message": "I am interested" }, "assistant_reply": "Sending your reply now." }

Rules:
- For any command like "Reply to my email" or "Reply to the latest", if the specific message content is missing, you MUST return intent: "LIST_EMAILS" to prompt for selection first.
- If the user provides an index (e.g., "the second one", "number 1"), extract it into 'email_index' as a number.
- NEVER return intent: "UNKNOWN" if the user mentions emails, calendar, docs, or sheets. Map to the closest valid intent.
- assistant_reply must be natural.
- Respond ONLY with the JSON object. No markdown.`;
}

// ── Main Classification Function ──────────────────────────────────────────────
/**
 * @param {string} transcript - The STT-transcribed text from the user.
 * @param {string} [userTimezone] - IANA timezone string, e.g. "America/New_York".
 * @returns {Promise<IntentResult>}
 */
async function classifyIntent(transcript, userTimezone = "UTC") {
  if (!transcript || transcript.trim().length === 0) {
    throw new Error("Empty transcript provided to classifyIntent");
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const model = process.env.OPENROUTER_MODEL;
  const systemPrompt = buildSystemPrompt(userTimezone);

  const requestBody = {
    model,
    max_tokens: 800,
    temperature: 0.1, // Low temperature for deterministic JSON
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Voice command: "${transcript.trim()}"` },
    ],
    // OpenRouter supports response_format for JSON-capable models
    response_format: { type: "json_object" },
  };

  let response;
  try {
    response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:3001",
        "X-Title": "AI Voice Assistant",
      },
      body: JSON.stringify(requestBody),
    });
  } catch (networkErr) {
    throw new Error(`OpenRouter network error: ${networkErr.message}`);
  }

  if (!response.ok) {
    let errBody = "";
    try {
      errBody = await response.text();
    } catch (_) {}
    throw new Error(`OpenRouter API error ${response.status}: ${errBody}`);
  }

  const completion = await response.json();

  // ── Parse Content ──────────────────────────────────────────────────────────
  const rawContent = completion?.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("OpenRouter returned an empty response");
  }

  let parsed;
  try {
    // Strip any accidental markdown fences that some models add despite instructions
    const cleaned = rawContent
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch (parseErr) {
    console.error("[openRouterService] Raw response:", rawContent);
    throw new Error(`Failed to parse OpenRouter JSON response: ${parseErr.message}`);
  }

  // ── Validate Schema ────────────────────────────────────────────────────────
  return validateAndNormalise(parsed);
}

// ── Validation & Normalisation ────────────────────────────────────────────────
function validateAndNormalise(parsed) {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("OpenRouter response is not a JSON object");
  }

  // Normalise intent
  const intent = String(parsed.intent || "UNKNOWN").toUpperCase();
  if (!VALID_INTENTS.includes(intent)) {
    parsed.intent = "UNKNOWN";
  } else {
    parsed.intent = intent;
  }

  // Ensure data object exists
  parsed.data = parsed.data || {};

  // Normalise ISO datetimes — ensure they are valid RFC3339
  for (const field of ["iso_start_datetime", "iso_end_datetime"]) {
    const val = parsed.data[field];
    if (val && typeof val === "string") {
      try {
        const date = parseISO(val);
        if (isValid(date)) {
          parsed.data[field] = formatISO(date); // normalise to RFC3339
        } else {
          parsed.data[field] = null;
        }
      } catch (_) {
        parsed.data[field] = null;
      }
    } else {
      parsed.data[field] = null;
    }
  }

  // Ensure attendees is always an array
  if (!Array.isArray(parsed.data.attendees)) {
    parsed.data.attendees = [];
  }
  if (!Array.isArray(parsed.data.attendee_names)) {
    parsed.data.attendee_names = [];
  }
  if (!Array.isArray(parsed.data.sheet_row_data)) {
    parsed.data.sheet_row_data = [];
  }

  // Ensure assistant_reply is always a string
  if (!parsed.assistant_reply || typeof parsed.assistant_reply !== "string") {
    parsed.assistant_reply = "I've processed your request.";
  }

  return parsed;
}

module.exports = { classifyIntent, buildSystemPrompt };
