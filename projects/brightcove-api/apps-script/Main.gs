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
