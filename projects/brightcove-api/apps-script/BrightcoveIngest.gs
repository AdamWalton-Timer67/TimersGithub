/**
 * Separate Brightcove image and subtitle ingestion.
 *
 * Reads the Drive source from column L and the Brightcove video ID from
 * CONFIG.COLUMN_VIDEO_ID on the same row. This module is not called by Sync.
 */
const BrightcoveIngest = (() => {
  const INGEST_BASE_URL =
    "https://ingest.api.brightcove.com/v1/accounts/";
  const DRIVE_LINK_COLUMN = 12; // Column L
  const MAX_ASSET_BYTES = 45 * 1024 * 1024;
  const LOCK_TIMEOUT_MS = 5000;

  let accessToken = null;
  let tokenExpiry = 0;

  /**
   * Validates and, unless dryRun is true, ingests assets for one sheet row.
   */
  function ingestAssetsForRow(rowNumber, options = {}) {
    const plan = buildPlanForRow_(rowNumber);

    if (options.dryRun) {
      return summarisePlan_(plan, true);
    }

    const lock = LockService.getDocumentLock();

    if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
      throw new Error(
        "Another asset ingest is already running. Try again when it finishes."
      );
    }

    try {
      const response = ingestSrtAndImages(
        plan.videoId,
        plan.images,
        plan.srtFiles
      );

      return {
        row: plan.row,
        videoId: plan.videoId,
        images: plan.images.map(asset => asset.file.getName()),
        textTracks: plan.srtFiles.map(asset => ({
          file: asset.file.getName(),
          language: asset.srclang
        })),
        jobId: response.job_id || null,
        response
      };
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Performs all reads and validation without uploading or submitting ingest.
   */
  function dryRunAssetsForRow(rowNumber) {
    return ingestAssetsForRow(rowNumber, { dryRun: true });
  }

  function buildPlanForRow_(rowNumber) {
    if (!Number.isInteger(rowNumber) || rowNumber <= CONFIG.HEADER_ROW) {
      throw new Error("A valid data row number is required.");
    }

    const sheet = SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(CONFIG.MAIN_SHEET_NAME);

    if (!sheet) {
      throw new Error("Main sheet not found.");
    }

    const videoId = String(
      sheet.getRange(rowNumber, CONFIG.COLUMN_VIDEO_ID).getDisplayValue()
    ).trim();
    const driveLink = String(
      sheet.getRange(rowNumber, DRIVE_LINK_COLUMN).getDisplayValue()
    ).trim();

    if (!videoId) {
      throw new Error("Missing Brightcove video ID on row " + rowNumber + ".");
    }

    if (!driveLink) {
      throw new Error(
        "Missing Google Drive link in column L on row " + rowNumber + "."
      );
    }

    // This read verifies the video exists and gives us its real variants.
    const video = BrightcoveApi.getVideo(videoId);

    if (!video || !video.id) {
      throw new Error("Brightcove video not found for row " + rowNumber + ".");
    }

    const files = getFilesFromDriveLink_(driveLink);
    const allowedLanguages = getVideoLanguages_(video);
    const assets = buildAssets_(files, allowedLanguages);

    if (!assets.images.length && !assets.srtFiles.length) {
      throw new Error(
        "No eligible thumbnail JPG/PNG or matched SRT files were found."
      );
    }

    return {
      row: rowNumber,
      videoId: String(video.id),
      driveLink,
      allowedLanguages,
      images: assets.images,
      srtFiles: assets.srtFiles
    };
  }

  function summarisePlan_(plan, dryRun) {
    return {
      row: plan.row,
      videoId: plan.videoId,
      driveLink: plan.driveLink,
      allowedLanguages: plan.allowedLanguages.slice(),
      images: plan.images.map(asset => ({
        file: asset.file.getName(),
        variant: "thumbnail",
        bytes: asset.file.getSize()
      })),
      textTracks: plan.srtFiles.map(asset => ({
        file: asset.file.getName(),
        language: asset.srclang,
        default: asset.default,
        bytes: asset.file.getSize()
      })),
      dryRun: Boolean(dryRun),
      writesPerformed: false
    };
  }

  /**
   * Lower-level entry point for already-resolved Drive files.
   */
  function ingestSrtAndImages(videoId, imageAssets, srtAssets) {
    if (!videoId) {
      throw new Error("A Brightcove video ID is required.");
    }

    preflightAssets_(imageAssets || [], srtAssets || []);

    const images = (imageAssets || []).map(asset => ({
      url: uploadFileToSource_(videoId, asset.file),
      variant: "thumbnail"
    }));

    const textTracks = (srtAssets || []).map(asset => ({
      url: uploadFileToSource_(videoId, asset.file),
      srclang: asset.srclang,
      kind: "subtitles",
      label: asset.label || asset.srclang,
      default: Boolean(asset.default),
      status: "published"
    }));

    if (!images.length && !textTracks.length) {
      throw new Error("No assets were supplied for ingest.");
    }

    const payload = {};
    if (images.length) payload.images = images;
    if (textTracks.length) payload.text_tracks = textTracks;

    return request_(
      "post",
      "/videos/" + encodeURIComponent(videoId) + "/ingest-requests",
      payload
    );
  }

  function getFilesFromDriveLink_(driveLink) {
    const id = extractDriveId_(driveLink);
    const files = [];

    try {
      if (/\/folders\//i.test(driveLink)) {
        collectFolderFiles_(DriveApp.getFolderById(id), files);
      } else {
        files.push(DriveApp.getFileById(id));
      }
    } catch (firstError) {
      try {
        collectFolderFiles_(DriveApp.getFolderById(id), files);
      } catch (folderError) {
        throw new Error(
          "Unable to open the Drive file or folder in column L. " +
          "Check the link and Apps Script permissions. " +
          folderError.message
        );
      }
    }

    if (!files.length) {
      throw new Error("The Drive folder linked in column L is empty.");
    }

    return files;
  }

  function collectFolderFiles_(folder, files) {
    const iterator = folder.getFiles();

    while (iterator.hasNext()) {
      files.push(iterator.next());
    }
  }

  function extractDriveId_(driveLink) {
    const value = String(driveLink || "").trim();
    const patterns = [
      /\/folders\/([A-Za-z0-9_-]+)/i,
      /\/d\/([A-Za-z0-9_-]+)/i,
      /[?&]id=([A-Za-z0-9_-]+)/i,
      /^([A-Za-z0-9_-]+)$/
    ];

    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (match) return match[1];
    }

    throw new Error("Column L does not contain a recognised Google Drive link.");
  }

  function getVideoLanguages_(video) {
    const languages = [];
    const masterLanguage = String(CONFIG.MASTER_LANGUAGE || "en").trim();

    addUnique_(languages, masterLanguage);

    const variants = BrightcoveApi.getVariants(video);

    variants.forEach(variant => {
      if (variant && variant.language) {
        addUnique_(languages, String(variant.language).trim());
      }
    });

    return languages;
  }

  function buildAssets_(files, allowedLanguages) {
    const images = [];
    const srtFiles = [];
    const languageFiles = {};

    files.forEach(file => {
      const name = file.getName();

      validateFileSize_(file);

      // Only a JPG or PNG containing the full term "thumbnail" qualifies.
      if (/thumbnail/i.test(name) && /\.(jpg|png)$/i.test(name)) {
        images.push({
          file,
          variant: "thumbnail"
        });
        return;
      }

      if (!/\.srt$/i.test(name)) return;

      const language = matchLanguageFromFilename_(name, allowedLanguages);

      if (!language) {
        throw new Error(
          "SRT filename does not contain a language/region matching an " +
          "existing video variant: " + name +
          ". Expected one of: " + allowedLanguages.join(", ")
        );
      }

      const key = language.toLowerCase();

      if (languageFiles[key]) {
        throw new Error(
          "More than one SRT matched " + language + ": " +
          languageFiles[key] + " and " + name
        );
      }

      languageFiles[key] = name;
      srtFiles.push({
        file,
        srclang: language,
        label: language,
        kind: "subtitles",
        default:
          language.toLowerCase() ===
          String(CONFIG.MASTER_LANGUAGE || "en").toLowerCase(),
        status: "published"
      });
    });

    if (images.length > 1) {
      throw new Error(
        "More than one thumbnail JPG/PNG was found: " +
        images.map(asset => asset.file.getName()).join(", ")
      );
    }

    return { images, srtFiles };
  }

  function matchLanguageFromFilename_(name, allowedLanguages) {
    const stem = name.replace(/\.srt$/i, "");
    const sorted = allowedLanguages.slice().sort(
      (a, b) => b.length - a.length
    );

    for (const language of sorted) {
      const escaped = escapeRegExp_(language);
      const pattern = new RegExp(
        "(^|[._ -])" + escaped + "($|[._ -])",
        "i"
      );

      if (pattern.test(stem)) return language;
    }

    return null;
  }

  function preflightAssets_(imageAssets, srtAssets) {
    if (imageAssets.length > 1) {
      throw new Error("Only one thumbnail image may be ingested per run.");
    }

    imageAssets.forEach(asset => {
      if (!asset || !asset.file) {
        throw new Error("Each image requires a Google Drive file.");
      }

      const name = asset.file.getName();

      if (!/thumbnail/i.test(name) || !/\.(jpg|png)$/i.test(name)) {
        throw new Error(
          "Image must contain 'thumbnail' and end in .jpg or .png: " + name
        );
      }

      validateFileSize_(asset.file);
    });

    const seenLanguages = {};

    srtAssets.forEach(asset => {
      if (!asset || !asset.file || !/\.srt$/i.test(asset.file.getName())) {
        throw new Error("Each subtitle asset must be an .srt Drive file.");
      }

      if (!asset.srclang) {
        throw new Error("Each SRT requires a matched variant language.");
      }

      const key = String(asset.srclang).toLowerCase();

      if (seenLanguages[key]) {
        throw new Error("Duplicate SRT language: " + asset.srclang);
      }

      seenLanguages[key] = true;
      validateFileSize_(asset.file);
    });
  }

  function validateFileSize_(file) {
    const size = file.getSize();

    if (size <= 0) {
      throw new Error("Drive file is empty: " + file.getName());
    }

    if (size > MAX_ASSET_BYTES) {
      throw new Error(
        "Drive file exceeds the safe 45 MB upload limit: " + file.getName()
      );
    }
  }

  function uploadFileToSource_(videoId, file) {
    const sourceName = safeSourceName_(file.getName());
    const uploadInfo = request_(
      "get",
      "/videos/" + encodeURIComponent(videoId) +
        "/upload-urls/" + encodeURIComponent(sourceName)
    );

    if (!uploadInfo.signed_url || !uploadInfo.api_request_url) {
      throw new Error(
        "Brightcove did not return complete upload URLs for " + sourceName + "."
      );
    }

    uploadToSignedUrl_(uploadInfo.signed_url, file);

    return uploadInfo.api_request_url;
  }

  function uploadToSignedUrl_(signedUrl, file) {
    const maxRetries = Math.min(Number(CONFIG.MAX_RETRIES) || 3, 3);
    let attempt = 0;

    while (true) {
      const response = UrlFetchApp.fetch(signedUrl, {
        method: "put",
        payload: file.getBlob().getBytes(),
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();

      if (code >= 200 && code < 300) return;

      if (
        (code === 408 || code === 429 || code >= 500) &&
        attempt < maxRetries
      ) {
        Utilities.sleep(retryDelay_(attempt++));
        continue;
      }

      throw new Error(
        "Temporary S3 upload failed for " + file.getName() +
        " (HTTP " + code + "): " + response.getContentText()
      );
    }
  }

  function request_(method, endpoint, payload) {
    const maxRetries = Number(CONFIG.MAX_RETRIES) || 3;
    let attempt = 0;
    let refreshedToken = false;

    while (true) {
      const options = {
        method,
        muteHttpExceptions: true,
        headers: {
          Authorization: "Bearer " + getAccessToken_(),
          "Content-Type": "application/json"
        }
      };

      if (payload != null) options.payload = JSON.stringify(payload);

      const response = UrlFetchApp.fetch(
        INGEST_BASE_URL + CONFIG.ACCOUNT_ID + endpoint,
        options
      );
      const code = response.getResponseCode();
      const body = response.getContentText();

      if (code >= 200 && code < 300) {
        return body ? JSON.parse(body) : {};
      }

      if (code === 401 && !refreshedToken) {
        accessToken = null;
        tokenExpiry = 0;
        refreshedToken = true;
        continue;
      }

      if (
        (code === 408 || code === 429 || code >= 500) &&
        attempt < maxRetries
      ) {
        Utilities.sleep(retryDelay_(attempt++));
        continue;
      }

      throw new Error(
        "Brightcove Dynamic Ingest error (HTTP " + code + "): " + body
      );
    }
  }

  function retryDelay_(attempt) {
    const initial = Number(CONFIG.INITIAL_RETRY_DELAY_MS) || 1000;
    const exponential = initial * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * Math.max(100, initial / 2));

    return exponential + jitter;
  }

  function getAccessToken_() {
    const now = Date.now();

    if (accessToken && now < tokenExpiry) return accessToken;

    const auth = Utilities.base64Encode(
      CONFIG.CLIENT_ID + ":" + CONFIG.CLIENT_SECRET
    );
    const response = UrlFetchApp.fetch(CONFIG.OAUTH_URL, {
      method: "post",
      muteHttpExceptions: true,
      headers: { Authorization: "Basic " + auth },
      payload: { grant_type: "client_credentials" }
    });

    if (response.getResponseCode() !== 200) {
      throw new Error(
        "Unable to obtain Brightcove OAuth token: " +
        response.getContentText()
      );
    }

    const token = JSON.parse(response.getContentText());

    if (!token.access_token || !token.expires_in) {
      throw new Error("Brightcove returned an invalid OAuth token response.");
    }

    accessToken = token.access_token;
    tokenExpiry = now + Math.max(
      0,
      token.expires_in - CONFIG.TOKEN_REFRESH_BUFFER_SECONDS
    ) * 1000;

    return accessToken;
  }

  function safeSourceName_(name) {
    const safe = String(name || "asset")
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "");

    if (!safe) throw new Error("The source file has no usable filename.");

    return Date.now() + "_" + safe;
  }

  function addUnique_(items, value) {
    const key = value.toLowerCase();

    if (!items.some(item => item.toLowerCase() === key)) {
      items.push(value);
    }
  }

  function escapeRegExp_(value) {
    return String(value).replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  }

  return {
    ingestAssetsForRow,
    dryRunAssetsForRow,
    ingestSrtAndImages
  };
})();