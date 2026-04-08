// server/services/calendarService.js
// ─────────────────────────────────────────────────────────────────────────────
// Google Calendar operations: insert events, check free/busy, list upcoming.
// All datetimes are validated RFC3339 before submission.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const { google } = require('googleapis');
const { parseISO, formatISO, addHours, isValid, isBefore } = require('date-fns');
const { getAuthenticatedClient } = require('../config/googleAuth');

// ── Helper: Get Authenticated Calendar Client ─────────────────────────────────
function getCalendarClient(userKey) {
  const auth = getAuthenticatedClient(userKey);
  return google.calendar({ version: 'v3', auth });
}

// ── Helper: Validate & Normalise RFC3339 ─────────────────────────────────────
/**
 * Validates an ISO string and returns a well-formed RFC3339 datetime string.
 * Throws if invalid.
 */
function toRFC3339(isoString, fieldName = 'datetime') {
  if (!isoString) throw new Error(`${fieldName} is required`);

  const date = parseISO(isoString);
  if (!isValid(date)) {
    throw new Error(`${fieldName} "${isoString}" is not a valid ISO 8601 date`);
  }

  return formatISO(date); // returns "2024-06-15T14:00:00+00:00" format
}

// ── Insert Calendar Event ─────────────────────────────────────────────────────
/**
 * Creates a new event on the user's primary Google Calendar.
 *
 * @param {object} params
 * @param {string} params.title              - Event title / summary.
 * @param {string} params.iso_start_datetime - ISO 8601 start datetime.
 * @param {string} [params.iso_end_datetime] - ISO 8601 end datetime. Defaults to start + 1 hour.
 * @param {string} [params.description]      - Optional event description.
 * @param {string} [params.location]         - Optional location.
 * @param {string[]} [params.attendees]      - Optional array of attendee email strings.
 * @param {string} [userKey]                 - OAuth user key.
 * @returns {Promise<{eventId: string, htmlLink: string, summary: string, start: string, end: string}>}
 */
async function insertEvent(
  {
    title,
    iso_start_datetime,
    iso_end_datetime,
    description = '',
    location = '',
    attendees = [],
  },
  userKey
) {
  if (!title) throw new Error('Event title is required');
  if (!iso_start_datetime) throw new Error('iso_start_datetime is required');

  // ── Normalise & validate datetimes ────────────────────────────────────────
  const startDate = parseISO(iso_start_datetime);
  if (!isValid(startDate)) {
    throw new Error(`iso_start_datetime "${iso_start_datetime}" is not a valid ISO 8601 date`);
  }

  let endDate;
  if (iso_end_datetime) {
    endDate = parseISO(iso_end_datetime);
    if (!isValid(endDate)) {
      throw new Error(`iso_end_datetime "${iso_end_datetime}" is not a valid ISO 8601 date`);
    }
    // Sanity check: end must be after start
    if (!isBefore(startDate, endDate)) {
      throw new Error('iso_end_datetime must be after iso_start_datetime');
    }
  } else {
    // Default to 1-hour duration
    endDate = addHours(startDate, 1);
  }

  const startRFC = formatISO(startDate);
  const endRFC = formatISO(endDate);

  // ── Build event resource ──────────────────────────────────────────────────
  const eventResource = {
    summary: title,
    description,
    location,
    start: {
      dateTime: startRFC,
      // Extract timezone offset or use UTC
      timeZone: 'UTC',
    },
    end: {
      dateTime: endRFC,
      timeZone: 'UTC',
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 60 },
        { method: 'popup', minutes: 10 },
      ],
    },
  };

  // Add attendees if provided
  if (attendees && attendees.length > 0) {
    eventResource.attendees = attendees
      .filter((email) => typeof email === 'string' && email.includes('@'))
      .map((email) => ({ email: email.trim() }));
  }

  const calendar = getCalendarClient(userKey);

  const { data: event } = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: eventResource,
    sendUpdates: attendees?.length > 0 ? 'all' : 'none',
  });

  console.log(`[calendarService] Event created — id: ${event.id}, link: ${event.htmlLink}`);

  return {
    eventId: event.id,
    htmlLink: event.htmlLink,
    summary: event.summary,
    start: event.start.dateTime,
    end: event.end.dateTime,
  };
}

// ── List Upcoming Events ──────────────────────────────────────────────────────
/**
 * Returns the next N upcoming events from the primary calendar.
 * @param {number} [maxResults=5]
 * @param {string} [userKey]
 * @returns {Promise<Array>}
 */
async function listUpcomingEvents(maxResults = 5, userKey) {
  const calendar = getCalendarClient(userKey);

  const { data } = await calendar.events.list({
    calendarId: 'primary',
    timeMin: new Date().toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: 'startTime',
  });

  return (data.items || []).map((e) => ({
    eventId: e.id,
    summary: e.summary,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    location: e.location,
    htmlLink: e.htmlLink,
  }));
}

// ── Check Free/Busy ───────────────────────────────────────────────────────────
/**
 * Returns true if the user is free during the proposed time window.
 * @param {string} iso_start_datetime
 * @param {string} iso_end_datetime
 * @param {string} [userKey]
 * @returns {Promise<boolean>}
 */
async function isTimeFree(iso_start_datetime, iso_end_datetime, userKey) {
  const calendar = getCalendarClient(userKey);

  const startRFC = toRFC3339(iso_start_datetime, 'iso_start_datetime');
  const endRFC = toRFC3339(iso_end_datetime, 'iso_end_datetime');

  const { data } = await calendar.freebusy.query({
    requestBody: {
      timeMin: startRFC,
      timeMax: endRFC,
      items: [{ id: 'primary' }],
    },
  });

  const busySlots = data.calendars?.primary?.busy || [];
  return busySlots.length === 0;
}

module.exports = {
  insertEvent,
  listUpcomingEvents,
  isTimeFree,
};