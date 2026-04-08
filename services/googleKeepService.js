// server/services/googleKeepService.js
"use strict";

const { google } = require("googleapis");
const { getAuthenticatedClient } = require("../config/googleAuth");

/**
 * Creates a Google Keep note via direct API call.
 * Requires the Keep API to be enabled in your Google Cloud Project.
 */
async function createKeepNote(title, content, userKey) {
  const auth = getAuthenticatedClient(userKey);

  const url = "https://keep.googleapis.com/v1/notes";
  const response = await auth.request({
    url,
    method: "POST",
    data: {
      title: title || `Note ${new Date().toLocaleDateString()}`,
      body: {
        text: {
          text: content,
        },
      },
    },
  });

  return {
    id: response.data.name,
    title: response.data.title,
    url: `https://keep.google.com/#NOTE/${response.data.name.split("/")[1]}`,
  };
}

/**
 * Lists the user's Google Keep notes.
 */
async function listKeepNotes(userKey, pageSize = 10) {
  const auth = getAuthenticatedClient(userKey);

  const url = `https://keep.googleapis.com/v1/notes?pageSize=${pageSize}`;
  const response = await auth.request({ url, method: "GET" });

  return response.data.notes || [];
}

module.exports = { createKeepNote, listKeepNotes };
