// server/controllers/authController.js
// ─────────────────────────────────────────────────────────────────────────────
// Handles Google OAuth2 initiation, callback, status, and logout.
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const { getAuthUrl, exchangeCodeForTokens, isAuthenticated, getStoredUserInfo, revokeTokens, DEFAULT_USER_KEY } = require("../config/googleAuth");

// ── Initiate Google OAuth Flow ────────────────────────────────────────────────
function initiateAuth(req, res) {
  try {
    const url = getAuthUrl(DEFAULT_USER_KEY);
    // For API consumers (frontend JS fetch), return the URL as JSON
    // For direct browser visits, redirect
    const acceptsJson = req.headers.accept?.includes("application/json");
    if (acceptsJson) {
      return res.json({ authUrl: url });
    }
    return res.redirect(url);
  } catch (err) {
    console.error("[authController] initiateAuth error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── OAuth2 Callback ───────────────────────────────────────────────────────────
async function handleCallback(req, res) {
  const { code, error, state } = req.query;
  const FRONTEND_URL = process.env.FRONTEND_URL;
  if (error) {
    console.error("[authController] OAuth denied by user:", error);
    return res.redirect(`${FRONTEND_URL}?auth=error&reason=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.status(400).json({ error: "Authorization code not provided" });
  }

  try {
    const userKey = state || DEFAULT_USER_KEY;
    const { userInfo } = await exchangeCodeForTokens(code, userKey);

    console.log(`[authController] OAuth success for: ${userInfo.email}`);

    // Redirect back to the frontend with success signal
    return res.redirect(`${FRONTEND_URL}?auth=success&email=${encodeURIComponent(userInfo.email)}`);
  } catch (err) {
    console.error("[authController] Token exchange failed:", err.message);
    return res.redirect(`${FRONTEND_URL}?auth=error&reason=${encodeURIComponent(err.message)}`);
  }
}

// ── Auth Status ───────────────────────────────────────────────────────────────
function getAuthStatus(req, res) {
  try {
    const authenticated = isAuthenticated(DEFAULT_USER_KEY);
    const userInfo = getStoredUserInfo(DEFAULT_USER_KEY);
    return res.json({ authenticated, user: userInfo });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ── Logout / Revoke ───────────────────────────────────────────────────────────
async function logout(req, res) {
  try {
    await revokeTokens(DEFAULT_USER_KEY);
    return res.json({ success: true, message: "Google account disconnected successfully." });
  } catch (err) {
    console.error("[authController] logout error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { initiateAuth, handleCallback, getAuthStatus, logout };
