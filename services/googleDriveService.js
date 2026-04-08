// server/services/googleDriveService.js
"use strict";

const { google } = require("googleapis");
const { getAuthenticatedClient } = require("../config/googleAuth");

/**
 * Searches for a file by name and optional MIME type.
 */
async function findFileByName(fileName, mimeType = null, userKey) {
  const auth = getAuthenticatedClient(userKey);
  const drive = google.drive({ version: "v3", auth });

  let query = `name = '${fileName.replace(/'/g, "\\'")}' and trashed = false`;
  if (mimeType) {
    query += ` and mimeType = '${mimeType}'`;
  }

  const response = await drive.files.list({
    q: query,
    spaces: "drive",
    fields: "files(id, name, mimeType)",
  });

  return response.data.files[0] || null;
}

/**
 * Creates a folder if it doesn't already exist.
 */
async function ensureFolder(folderName, userKey) {
  const auth = getAuthenticatedClient(userKey);
  const drive = google.drive({ version: "v3", auth });

  const existingFolder = await findFileByName(folderName, "application/vnd.google-apps.folder", userKey);
  if (existingFolder) return existingFolder.id;

  const response = await drive.files.create({
    resource: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });

  return response.data.id;
}

/**
 * Lists recent files.
 */
async function listRecentFiles(pageSize = 10, userKey) {
  const auth = getAuthenticatedClient(userKey);
  const drive = google.drive({ version: "v3", auth });

  const response = await drive.files.list({
    pageSize,
    fields: "files(id, name, mimeType, modifiedTime)",
    orderBy: "modifiedTime desc",
  });

  return response.data.files;
}

module.exports = { findFileByName, ensureFolder, listRecentFiles };
