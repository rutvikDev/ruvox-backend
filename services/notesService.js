// server/services/notesService.js
"use strict";

const { google } = require("googleapis");
const { getAuthenticatedClient } = require("../config/googleAuth");
const { ensureFolder } = require("./googleDriveService");

/**
 * Creates a "Note" in the "Notes" Drive folder.
 * Note: Since there is no public Keep API for consumers, we use a folder "Notes" in Drive.
 */
async function createNote(title, content, userKey) {
  const auth = getAuthenticatedClient(userKey);
  const drive = google.drive({ version: "v3", auth });

  const notesFolderId = await ensureFolder("My Voice Assistant Notes", userKey);

  const response = await drive.files.create({
    resource: {
      name: title || `Note ${new Date().toLocaleDateString()}`,
      mimeType: "application/vnd.google-apps.document", // Simple Doc as a note
      parents: [notesFolderId],
    },
    media: {
      mimeType: "text/plain",
      body: content,
    },
    fields: "id, name, webViewLink",
  });

  return {
    id: response.data.id,
    title: response.data.name,
    url: response.data.webViewLink,
  };
}

module.exports = { createNote };
