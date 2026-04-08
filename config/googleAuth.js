// server/config/googleAuth.js
// ─────────────────────────────────────────────────────────────────────────────
// Centralised Google OAuth2 client + in-memory token store.
// In production replace tokenStore with Redis or a database.
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const { google } = require("googleapis");

// ── OAuth2 Scopes ─────────────────────────────────────────────────────────────
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/youtube.readonly",
];

// ── Token Store (in-memory MVP) ───────────────────────────────────────────────
// Structure: { [userId: string]: { access_token, refresh_token, expiry_date, email } }
const tokenStore = new Map();

// For this MVP we use a single "default" user key.
const DEFAULT_USER_KEY = "default";

// ── OAuth2 Client Factory ─────────────────────────────────────────────────────
/**
 * Creates a fresh OAuth2 client with credentials from env.
 * If tokens exist for the user, they are loaded automatically.
 */
function createOAuth2Client(userKey = DEFAULT_USER_KEY) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );

  const tokens = tokenStore.get(userKey);
  if (tokens) {
    client.setCredentials(tokens);
  }

  // Auto-refresh handler — persist the refreshed token
  client.on("tokens", (newTokens) => {
    const existing = tokenStore.get(userKey) || {};
    const merged = { ...existing, ...newTokens };
    // Google only returns refresh_token on first auth; preserve old one
    if (!merged.refresh_token && existing.refresh_token) {
      merged.refresh_token = existing.refresh_token;
    }
    tokenStore.set(userKey, merged);
    console.log(`[googleAuth] Tokens refreshed for user: ${userKey}`);
  });

  return client;
}

// ── Auth URL Generator ────────────────────────────────────────────────────────
function getAuthUrl(userKey = DEFAULT_USER_KEY) {
  const client = createOAuth2Client(userKey);
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // force consent to always get refresh_token
    state: userKey, // passed back in callback so we know which user
  });
}

// ── Exchange Code for Tokens ──────────────────────────────────────────────────
async function exchangeCodeForTokens(code, userKey = DEFAULT_USER_KEY) {
  const client = createOAuth2Client(userKey);
  const { tokens } = await client.getToken(code);

  // Fetch user info to store alongside tokens
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data: userInfo } = await oauth2.userinfo.get();

  const stored = { ...tokens, email: userInfo.email, name: userInfo.name };
  tokenStore.set(userKey, stored);

  console.log(`[googleAuth] Tokens stored for: ${userInfo.email}`);
  return { tokens: stored, userInfo };
}

// ── Token Validity Check ──────────────────────────────────────────────────────
function isAuthenticated(userKey = DEFAULT_USER_KEY) {
  const tokens = tokenStore.get(userKey);
  return !!(tokens && (tokens.refresh_token || tokens.access_token));
}

// ── Authenticated Client (throws if not authed) ───────────────────────────────
function getAuthenticatedClient(userKey = DEFAULT_USER_KEY) {
  if (!isAuthenticated(userKey)) {
    const err = new Error("Google account not connected. Please authenticate first.");
    err.status = 401;
    throw err;
  }
  return createOAuth2Client(userKey);
}

// ── Get Stored User Info ──────────────────────────────────────────────────────
function getStoredUserInfo(userKey = DEFAULT_USER_KEY) {
  const tokens = tokenStore.get(userKey);
  if (!tokens) return null;
  return { email: tokens.email, name: tokens.name };
}

// ── Revoke / Logout ───────────────────────────────────────────────────────────
async function revokeTokens(userKey = DEFAULT_USER_KEY) {
  const client = createOAuth2Client(userKey);
  const tokens = tokenStore.get(userKey);
  if (tokens && tokens.access_token) {
    try {
      await client.revokeToken(tokens.access_token);
    } catch (e) {
      console.warn("[googleAuth] Token revoke failed (may already be expired):", e.message);
    }
  }
  tokenStore.delete(userKey);
}

module.exports = {
  createOAuth2Client,
  getAuthUrl,
  exchangeCodeForTokens,
  isAuthenticated,
  getAuthenticatedClient,
  getStoredUserInfo,
  revokeTokens,
  DEFAULT_USER_KEY,
  SCOPES,
};
