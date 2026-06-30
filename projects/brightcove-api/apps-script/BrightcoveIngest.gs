/**
 * Uploads Google Drive images and native SRT files through Brightcove's
 * temporary S3 storage, then attaches them to an existing video.
 *
 * Required OAuth permissions:
 * - Dynamic Ingest > Create
 * - Dynamic Ingest > Push Files (video-cloud/upload-urls/read)
 * - CMS > Video Read
 */
const BrightcoveIngest = (() => {
  const INGEST_BASE_URL =
    "https://ingest.api.brightcove.com/v1/accounts/";
  const DRIVE_LINK_COLUMN = 12; // Column L

  let accessToken = null;
  let tokenExpiry = 0;

  /**
   * Reads the video ID and Drive link from one row of the original sheet.
   *
   * Column L may contain a Drive folder link or a direct Drive file link.
   * The Brightcove video ID is read from CONFIG.COLUMN_VIDEO_ID.
   *
   * Folder filename conventions:
   * - poster.jpg, thumbnail.png, square.jpg, wide.jpg, etc.
   * - captions_en.srt, captions_fr.srt, captions_en-GB.srt, etc.
   */
  function ingestAssetsForRow(rowNumber, options = {}) {
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
      throw new Error("Missing Google Drive link in column L on row " + rowNumber + ".");
    }

    const files = getFilesFromDriveLink_(driveLink);
    const assets = buildAssets_(files);

    if (options.dryRun) {
      return {
        row: rowNumber,
        videoId,
        driveLink,
        images: assets.images.map(asset => asset.file.getName()),
        srtFiles: assets.srtFiles.map(asset => asset.file.getName()),
        dryRun: true
      };
    }

    return ingestSrtAndImages(videoId, assets.images, assets.srtFiles);
  }

  /**
   * imageAssets:
   * [{ file, variant: "poster", width: 1280, height: 720, language: "en" }]
   *
   * srtAssets:
   * [{ file, srclang: "en", label: "English", kind: "subtitles",
   *    default: true, status: "published" }]
   */
  function ingestSrtAndImages(videoId, imageAssets, srtAssets) {
    if (!videoId) {
      throw new Error("A Brightcove video ID is required.");
    }

    const images = (imageAssets || []).map(asset => {
      validateImageAsset_(asset);

      const image = {
        url: uploadFileToSource_(videoId, asset.file),
        variant: asset.variant
      };

      if (asset.width != null) image.width = asset.width;
      if (asset.height != null) image.height = asset.height;
      if (asset.language) image.language = asset.language;

      return image;
    });

    const textTracks = (srtAssets || []).map(asset => {
      validateSrtAsset_(asset);

      return {
        url: uploadFileToSource_(videoId, asset.file),
        srclang: asset.srclang,
        kind: asset.kind || "subtitles",
        label: asset.label || asset.srclang,
        default: Boolean(asset.default),
        status: asset.status || "published"
      };
    });

    if (!images.length && !textTracks.length) {
      throw new Error("No supported images or SRT files were found.");
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

  function uploadImagesToVideo(videoId, imageAssets) {
    return ingestSrtAndImages(videoId, imageAssets, []);
  }

  function uploadSrtToVideo(videoId, srtAssets) {
    return ingestSrtAndImages(videoId, [], srtAssets);
  }

  function getFilesFromDriveLink_(driveLink) {
    const id = extractDriveId_(driveLink);
    const files = [];

    if (/\/folders\//i.test(driveLink)) {
      const iterator = DriveApp.getFolderById(id).getFiles();

      while (iterator.hasNext()) {
        files.push(iterator.next());
      }

      return files;
    }

    try {
      files.push(DriveApp.getFileById(id));
      return files;
    } catch (fileError) {
      const iterator = DriveApp.getFolderById(id).getFiles();

      while (iterator.hasNext()) {
        files.push(iterator.next());
      }

      return files;
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

  function buildAssets_(files) {
    const images = [];
    const srtFiles = [];
    const srtCandidates = [];

    for (const file of files) {
      const name = file.getName();
      const mimeType = file.getMimeType();

      if (
        /^image\//i.test(mimeType) ||
        /\.(jpe?g|png|gif)$/i.test(name)
      ) {
        images.push({
          file,
          variant: inferImageVariant_(name)
        });
      } else if (/\.srt$/i.test(name)) {
        srtCandidates.push(file);
      }
    }

    srtCandidates.forEach((file, index) => {
      const language = inferLanguage_(file.getName());

      srtFiles.push({
        file,
        srclang: language,
        label: language,
        kind: "subtitles",
        default: index === 0,
        status: "published"
      });
    });

    return { images, srtFiles };
  }

  function inferImageVariant_(name) {
    const lower = name.toLowerCase();

    if (/ultra[-_ ]?wide/.test(lower)) return "ultra-wide";
    if (/thumbnail|thumb/.test(lower)) return "thumbnail";
    if (/portrait/.test(lower)) return "portrait";
    if (/square/.test(lower)) return "square";
    if (/wide/.test(lower)) return "wide";
    return "poster";
  }

  function inferLanguage_(name) {
    const stem = name.replace(/\.srt$/i, "");
    const match = stem.match(
      /(?:^|[._ -])([a-z]{2}(?:-[A-Z]{2})?)(?:$|[._ -])/i
    );

    if (match) return match[1];

    return CONFIG.MASTER_LANGUAGE || "en";
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
        "Brightcove did not return upload URLs for " + sourceName + "."
      );
    }

    const response = UrlFetchApp.fetch(uploadInfo.signed_url, {
      method: "put",
      payload: file.getBlob().getBytes(),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();

    if (code < 200 || code >= 300) {
      throw new Error(
        "Temporary S3 upload failed for " + sourceName +
        " (HTTP " + code + "): " + response.getContentText()
      );
    }

    return uploadInfo.api_request_url;
  }

  function request_(method, endpoint, payload) {
    let attempt = 0;

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

      if (
        (code === 429 || code >= 500) &&
        attempt < CONFIG.MAX_RETRIES
      ) {
        const delay =
          CONFIG.INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);

        attempt++;
        Utilities.sleep(delay);
        continue;
      }

      throw new Error(
        "Brightcove Dynamic Ingest error (HTTP " + code + "): " + body
      );
    }
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

  function validateImageAsset_(asset) {
    const variants = [
      "poster", "thumbnail", "portrait", "square", "wide", "ultra-wide"
    ];

    if (!asset || !asset.file) {
      throw new Error("Each image requires a Google Drive file.");
    }

    if (variants.indexOf(asset.variant) === -1) {
      throw new Error("Invalid Brightcove image variant: " + asset.variant);
    }
  }

  function validateSrtAsset_(asset) {
    if (!asset || !asset.file) {
      throw new Error("Each SRT requires a Google Drive file.");
    }

    if (!/\.srt$/i.test(asset.file.getName())) {
      throw new Error("Expected an .srt file: " + asset.file.getName());
    }

    if (!asset.srclang) {
      throw new Error("Each SRT requires srclang.");
    }
  }

  return {
    ingestAssetsForRow,
    ingestSrtAndImages,
    uploadImagesToVideo,
    uploadSrtToVideo
  };
})();