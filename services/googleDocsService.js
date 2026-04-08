// server/services/googleDocsService.js
"use strict";

const { google } = require("googleapis");
const { getAuthenticatedClient } = require("../config/googleAuth");
const { findFileByName } = require("./googleDriveService");

/**
 * Creates a Google Doc.
 */
async function createDocument(title, userKey) {
  const auth = getAuthenticatedClient(userKey);
  const docs = google.docs({ version: "v1", auth });

  const response = await docs.documents.create({
    resource: {
      title,
    },
  });

  return {
    documentId: response.data.documentId,
    title: response.data.title,
    url: `https://docs.google.com/document/d/${response.data.documentId}/edit`,
  };
}

/**
 * Updates a Google Doc with new content.
 * Note: Appends content by default.
 */
async function updateDocument(documentId, content, userKey) {
  const auth = getAuthenticatedClient(userKey);
  const docs = google.docs({ version: "v1", auth });

  // Get current state to know index
  const doc = await docs.documents.get({ documentId });
  const index = (doc.data.body.content.slice(-1)[0].endIndex || 1) - 1;

  const response = await docs.documents.batchUpdate({
    documentId,
    resource: {
      requests: [
        {
          insertText: {
            location: { index },
            text: `\n${content}`,
          },
        },
      ],
    },
  });

  return response.data;
}

/**
 * Finds a document by title and updates it.
 */
async function updateDocumentByTitle(title, content, userKey) {
  const file = await findFileByName(title, "application/vnd.google-apps.document", userKey);
  if (!file) {
    throw new Error(`Document "${title}" not found.`);
  }
  return updateDocument(file.id, content, userKey);
}

module.exports = { createDocument, updateDocument, updateDocumentByTitle };
