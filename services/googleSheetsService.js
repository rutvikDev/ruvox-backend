// server/services/googleSheetsService.js
"use strict";

const { google } = require("googleapis");
const { getAuthenticatedClient } = require("../config/googleAuth");
const { findFileByName } = require("./googleDriveService");

/**
 * Creates a Google Spreadsheet.
 */
async function createSpreadsheet(title, userKey) {
  const auth = getAuthenticatedClient(userKey);
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.create({
    resource: {
      properties: {
        title,
      },
    },
  });

  return {
    spreadsheetId: response.data.spreadsheetId,
    title: response.data.properties.title,
    url: response.data.spreadsheetUrl,
  };
}

/**
 * Appends rows to a Spreadsheet by spreadsheetId.
 */
async function addRows(spreadsheetId, values, range = "Sheet1!A1", userKey) {
  const auth = getAuthenticatedClient(userKey);
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    resource: {
      values: [values],
    },
  });

  return response.data;
}

/**
 * Finds a spreadsheet by title and appends row.
 */
async function addRowsByTitle(title, values, range = "Sheet1!A1", userKey) {
  const file = await findFileByName(title, "application/vnd.google-apps.spreadsheet", userKey);
  if (!file) {
    throw new Error(`Spreadsheet "${title}" not found.`);
  }
  return addRows(file.id, values, range, userKey);
}

module.exports = { createSpreadsheet, addRows, addRowsByTitle };
