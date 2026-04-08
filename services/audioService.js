// server/services/audioService.js
// ─────────────────────────────────────────────────────────────────────────────
// STT: Sends audio buffer to Groq Whisper (free tier).
// TTS: Converts text to speech via google-tts-api → returns Buffer.
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fetch = require("node-fetch");
const FormData = require("form-data");
const googleTTS = require("google-tts-api");

const localStt = require("./localSttService");

// ── Speech-to-Text (Local Whisper via Transformers.js) ─────────────────────────
/**
 * Transcribes audio using local Whisper model.
 *
 * @param {Buffer} audioBuffer  - Raw audio bytes (webm, mp4, wav, m4a, etc.)
 * @param {string} mimeType     - MIME type of the audio (e.g. "audio/webm")
 * @param {string} [language]   - Optional ISO-639-1 language code (e.g. "en")
 * @returns {Promise<string>}   - Transcribed text
 */
async function transcribeAudio(audioBuffer, mimeType = "audio/webm", language = "en") {
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error("Empty audio buffer provided to transcribeAudio");
  }

  try {
    // Call the local STT service
    const text = await localStt.transcribe(audioBuffer);
    
    if (!text) {
      throw new Error("Local Whisper returned no transcription text");
    }

    console.log(`[audioService] Local Transcribed: "${text}"`);
    return text;
  } catch (err) {
    console.error(`[audioService] Local STT failed: ${err.message}`);
    
    // Optional: Fallback to Groq if specifically configured
    if (process.env.STT_FALLBACK_TO_GROQ === "true") {
      console.log("[audioService] Falling back to Groq API...");
      return transcribeAudioGroq(audioBuffer, mimeType, language);
    }
    
    throw err;
  }
}

/**
 * Transcribes audio using Groq Whisper (Legacy / Fallback).
 */
async function transcribeAudioGroq(audioBuffer, mimeType = "audio/webm", language = "en") {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured for fallback.");

  const extensionMap = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/m4a": "m4a",
    "video/webm": "webm",
  };
  const ext = extensionMap[mimeType] || "webm";

  const form = new FormData();
  form.append("file", audioBuffer, {
    filename: `audio.${ext}`,
    contentType: mimeType,
  });
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "json");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
    body: form,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq Whisper API error ${response.status}: ${errText}`);
  }

  const result = await response.json();
  return result.text.trim();
}

// ── Text-to-Speech (Google TTS - Totally Free) ──────────────────────────────
/**
 * Converts text to speech using Google TTS (Free).
 *
 * @param {string} text        - Text to convert to speech.
 * @param {string} [voice]     - Not used by Google TTS.
 * @returns {Promise<Buffer>}  - MP3 audio buffer.
 */
async function synthesizeSpeech(text, voice) {
  if (!text || text.trim().length === 0) {
    throw new Error("Empty text provided to synthesizeSpeech");
  }

  try {
    const results = await googleTTS.getAllAudioBase64(text, {
      lang: "en",
      slow: false,
      host: "https://translate.google.com",
      splitPunct: ",.?",
    });

    const buffers = results.map((res) => Buffer.from(res.base64, "base64"));
    const finalBuffer = Buffer.concat(buffers);

    console.log(`[audioService] Google TTS generated — ${finalBuffer.length} bytes`);
    return finalBuffer;
  } catch (error) {
    throw new Error(`Google TTS API error: ${error.message}`);
  }
}

module.exports = { transcribeAudio, synthesizeSpeech };
