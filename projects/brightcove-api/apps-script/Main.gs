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
      "Dry Run Metadata",
      "dryRunMetadata"
    )

    .addSeparator()

    .addItem(
      "Ingest Assets For Selected Row",
      "ingestAssetsForSelectedRow"
    )

    .addItem(
      "Dry Run Assets For Selected Row",
      "dryRunAssetsForSelectedRow"
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
 * Executes a normal metadata synchronisation.
 * Asset ingest is deliberately not part of this operation.
 */
function syncBrightcoveMetadata() {

  Sync.run({

    dryRun: false

  });

}

/**
 * Executes a metadata-only dry run.
 */
function dryRunMetadata() {

  Sync.run({

    dryRun: true

  });

}

/**
 * Runs image/SRT ingest only for the currently selected sheet row.
 */
function ingestAssetsForSelectedRow() {

  runAssetIngestForSelectedRow_(false);

}

/**
 * Validates image/SRT ingest for the selected row without any writes.
 */
function dryRunAssetsForSelectedRow() {

  runAssetIngestForSelectedRow_(true);

}

function runAssetIngestForSelectedRow_(dryRun) {

  const ui = SpreadsheetApp.getUi();

  try {

    const sheet = SpreadsheetApp
      .getActiveSpreadsheet()
      .getActiveSheet();

    if (
      !sheet ||
      sheet.getName() !== CONFIG.MAIN_SHEET_NAME
    ) {

      throw new Error(
        "Select a row in the " +
        CONFIG.MAIN_SHEET_NAME +
        " sheet first."
      );

    }

    const rowNumber = sheet
      .getActiveRange()
      .getRow();

    if (rowNumber <= CONFIG.HEADER_ROW) {

      throw new Error(
        "Select a video data row, not the header."
      );

    }

    const result = dryRun
      ? BrightcoveIngest.dryRunAssetsForRow(rowNumber)
      : BrightcoveIngest.ingestAssetsForRow(rowNumber);

    ui.alert(
      dryRun
        ? "Asset dry run passed"
        : "Asset ingest submitted",
      JSON.stringify(result, null, 2),
      ui.ButtonSet.OK
    );

  }

  catch (error) {

    Log.exception(error);

    ui.alert(
      dryRun
        ? "Asset dry run failed"
        : "Asset ingest failed",
      error.message,
      ui.ButtonSet.OK
    );

  }

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
