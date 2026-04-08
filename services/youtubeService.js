// server/services/youtubeService.js
"use strict";

const { google } = require("googleapis");
const { getAuthenticatedClient } = require("../config/googleAuth");

/**
 * Searches for YouTube videos by query.
 */
async function searchYouTube(query, userKey, maxResults = 5) {
  const auth = getAuthenticatedClient(userKey);
  const youtube = google.youtube({ version: "v3", auth });

  const response = await youtube.search.list({
    q: query,
    part: "snippet",
    type: "video",
    maxResults,
  });

  const videos = response.data.items.map((item) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails.default.url,
    description: item.snippet.description,
    url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
  }));

  return videos;
}

module.exports = { searchYouTube };
