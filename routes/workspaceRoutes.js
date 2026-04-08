// server/routes/workspaceRoutes.js
"use strict";

const express = require("express");
const router = express.Router();
const workspaceController = require("../controllers/workspaceController");

// Google Docs
router.post("/docs/create", workspaceController.createDoc);

// Google Sheets
router.post("/sheets/create", workspaceController.createSheet);

// Gmail Interactive
router.get("/emails/list", workspaceController.listEmails);
router.post("/emails/reply", workspaceController.replyToEmailReq);

// YouTube
router.get("/youtube/search", workspaceController.youtubeSearch);

module.exports = router;
