// server/routes/authRoutes.js
"use strict";

const express = require("express");
const { initiateAuth, handleCallback, getAuthStatus, logout } = require("../controllers/authController");

const router = express.Router();

// GET /api/auth/google — starts OAuth flow
router.get("/google", initiateAuth);

// GET /api/auth/callback — Google redirects here with code
router.get("/callback", handleCallback);

// GET /api/auth/status — check if user is authed
router.get("/status", getAuthStatus);

// POST /api/auth/logout — revoke tokens
router.post("/logout", logout);

module.exports = router;
