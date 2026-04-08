// server/routes/voiceRoutes.js
"use strict";

const express = require("express");
const multer = require("multer");
const { transcribeAudioRequest, executeCommandRequest, getStatus } = require("../controllers/voiceController");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "audio/webm",
      "audio/ogg",
      "audio/wav",
      "audio/wave",
      "audio/mp4",
      "audio/mpeg",
      "audio/mp3",
      "audio/m4a",
      "video/webm",
      "application/octet-stream",
    ];
    if (allowed.includes(file.mimetype) || file.fieldname === "audio") {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported audio format: ${file.mimetype}`));
    }
  },
});

router.post("/transcribe", upload.single("audio"), transcribeAudioRequest);
// NOTE: express.json() is required for this route if not applied globally in server.js
router.post("/execute", express.json(), executeCommandRequest);

router.get("/status", getStatus);

module.exports = router;
