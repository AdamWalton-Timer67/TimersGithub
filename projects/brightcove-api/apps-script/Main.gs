/***********************************************************************
 * Brightcove Metadata Synchroniser
 *
 * Main.gs
 *
 * Script entry points.
 ***********************************************************************/

/**
 * Adds the Brightcove menu whenever the spreadsheet opens.
 */
function onOpen() {

  SpreadsheetApp
    .getUi()
    .createMenu("Brightcove")

    .addItem(
      "Synchronise Metadata",
      "syncBrightcoveMetadata"
    )

    .addItem(
      "Dry Run",
      "dryRunMetadata"
    )

    .addSeparator()

    .addItem(
      "Reload Lessons Cache",
      "reloadLessonsCache"
    )

    .addItem(
      "Test Brightcove Connection",
      "testBrightcoveConnection"
    )

    .addToUi();

}

/**
 * Executes a normal synchronisation.
 */
function syncBrightcoveMetadata() {

  Sync.run({

    dryRun: false

  });

}

/**
 * Executes a dry run.
 */
function dryRunMetadata() {

  Sync.run({

    dryRun: true

  });

}

/**
 * Clears and reloads the Lessons cache.
 */
function reloadLessonsCache() {

  Lessons.clearCache();

  Lessons.load();

  SpreadsheetApp
    .getUi()
    .alert(
      "Lessons cache reloaded successfully."
    );

}

/**
 * Tests the Brightcove connection.
 */
function testBrightcoveConnection() {

  try {

    BrightcoveApi.testConnection();

    SpreadsheetApp
      .getUi()
      .alert(
        "Successfully connected to Brightcove."
      );

  }

  catch (error) {

    Log.exception(error);

    SpreadsheetApp
      .getUi()
      .alert(

        "Unable to connect to Brightcove.\n\n" +

        error.message

      );

  }

}

--------------------

/***********************************************************************
 * Brightcove Metadata Synchroniser
 *
 * Config.gs
 *
 * Global configuration for the synchronisation project.
 *
 * This should be the ONLY file that requires editing when deploying
 * into another Brightcove account.
 ***********************************************************************/

const CONFIG = Object.freeze({

  /*********************************************************************
   * Brightcove
   *********************************************************************/

  ACCOUNT_ID: "1234567890001",

  CLIENT_ID: "YOUR_CLIENT_ID",

  CLIENT_SECRET: "YOUR_CLIENT_SECRET",

  OAUTH_URL:
    "https://oauth.brightcove.com/v4/access_token",

  CMS_BASE_URL:
    "https://cms.api.brightcove.com/v1/accounts/",

  REQUEST_DELAY_MS: 250,

  MAX_RETRIES: 5,

  INITIAL_RETRY_DELAY_MS: 1000,

  TOKEN_REFRESH_BUFFER_SECONDS: 60,


  /*********************************************************************
   * Lessons Spreadsheet
   *********************************************************************/

  LESSONS_SPREADSHEET_ID:
    "1ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789",

  LESSONS_SHEET_NAME:
    "Lessons",


  /*********************************************************************
   * Main Spreadsheet
   *********************************************************************/

  MAIN_SHEET_NAME:
    "Sheet1",

  HEADER_ROW: 1,


  /*********************************************************************
   * Main Sheet Columns (1-based)
   *********************************************************************/

  COLUMN_REFERENCE_ID: 13,     // M

  COLUMN_VIDEO_ID: 14,         // N

  COLUMN_STATUS: 16,           // P


  /*********************************************************************
   * Lessons Sheet Layout
   *********************************************************************/

  LESSON_COLUMN_REFERENCE: 1,

  TITLE_COLUMNS: {

    en: 2,
    fr: 3,
    de: 4,
    es: 5,
    ja: 6,
    it: 7,
    zh: 8,
    ko: 9

  },

  DESCRIPTION_COLUMNS: {

    en: 11,
    fr: 12,
    de: 13,
    es: 14,
    ja: 15,
    it: 16,
    zh: 17,
    ko: 18

  },


  /*********************************************************************
   * Languages
   *
   * English is always the master video.
   *********************************************************************/

  MASTER_LANGUAGE: "en",

  VARIANT_LANGUAGES: [

    "fr",
    "de",
    "es",
    "ja",
    "it",
    "zh",
    "ko"

  ],


  /*********************************************************************
   * Validation
   *********************************************************************/

  MAX_DESCRIPTION_LENGTH: 248,

  MAX_LONG_DESCRIPTION_LENGTH: 5000,


  /*********************************************************************
   * Runtime
   *********************************************************************/

  DEBUG: true

});
