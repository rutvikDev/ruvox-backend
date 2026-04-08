// server/services/localSttService.js
"use strict";

const fs = require("fs");
const path = require("path");
const { PassThrough } = require("stream");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

// Set the static FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Local STT Service using HuggingFace Transformers.js (Whisper)
 */
class LocalSttService {
  constructor() {
    this.pipeline = null;
    this.modelName = process.env.WHISPER_MODEL;
  }

  /**
   * Initializes the Whisper pipeline (lazy-loading)
   */
  async init() {
    // Refresh model name in case it changed in .env
    this.modelName = process.env.WHISPER_MODEL;

    if (this.pipeline && this.pipeline.model === this.modelName) return;

    console.log(`[localSttService] Loading Whisper model: ${this.modelName}...`);
    try {
      // Dynamic import for ESM-only @huggingface/transformers
      const { pipeline } = await import("@huggingface/transformers");

      this.pipeline = await pipeline("automatic-speech-recognition", this.modelName, {
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      console.log("[localSttService] Model loaded successfully.");
    } catch (err) {
      console.error("[localSttService] Error loading model:", err);
      throw new Error(`Failed to load STT model: ${err.message}`);
    }
  }

  /**
   * Transcribes an audio buffer locally.
   *
   * @param {Buffer} audioBuffer - Raw audio data (webm, mp3, wav, etc.)
   * @returns {Promise<string>} - Transcribed text
   */
  async transcribe(audioBuffer) {
    await this.init();

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error("Empty audio buffer provided.");
    }

    console.log(`[localSttService] Transcribing ${audioBuffer.length} bytes...`);
    const startTime = Date.now();

    try {
      // 1. Convert audio to 16kHz mono Float32 PCM (required by Whisper)
      const pcmData = await this.convertToPcm(audioBuffer);

      // 2. Run inference
      const result = await this.pipeline(pcmData);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[localSttService] Transcription complete in ${duration}s: "${result.text}"`);

      return result.text.trim();
    } catch (err) {
      console.error("[localSttService] Transcription error:", err);
      throw err;
    }
  }

  /**
   * Converts input audio buffer to Float32Array PCM at 16kHz.
   * Uses fluent-ffmpeg and ffmpeg-static.
   */
  async convertToPcm(audioBuffer) {
    return new Promise((resolve, reject) => {
      const bufferStream = new PassThrough();
      bufferStream.end(audioBuffer);

      const outputBuffers = [];

      ffmpeg(bufferStream)
        .audioFilters("volume=1.5") // Boost volume for better recognition
        .toFormat("f32le") // Float32 Little Endian
        .audioChannels(1)
        .audioFrequency(16000)
        .on("error", (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
        .pipe()
        .on("data", (chunk) => outputBuffers.push(chunk))
        .on("end", () => {
          const finalBuffer = Buffer.concat(outputBuffers);
          // Convert Node Buffer to Float32Array for Transformers.js
          const float32Array = new Float32Array(finalBuffer.buffer, finalBuffer.byteOffset, finalBuffer.byteLength / 4);
          resolve(float32Array);
        });
    });
  }
}

module.exports = new LocalSttService();
