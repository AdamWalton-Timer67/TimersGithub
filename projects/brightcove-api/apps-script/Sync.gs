/***********************************************************************
 * Brightcove Metadata Synchroniser
 *
 * Sync.gs
 *
 * Main synchronisation engine.
 ***********************************************************************/

const Sync = (() => {

  /**
   * Entry point.
   */
  function run(options = {}) {

    options = Object.assign({

      dryRun: false

    }, options);

    Log.info(
      "Starting synchronisation..."
    );

    Lessons.load();

    const spreadsheet =
      SpreadsheetApp
        .getActiveSpreadsheet();

    const sheet =
      spreadsheet.getSheetByName(
        CONFIG.MAIN_SHEET_NAME
      );

    if (!sheet) {

      throw new Error(
        "Main sheet not found."
      );

    }

    const values =
      sheet
        .getDataRange()
        .getValues();

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (

      let row = CONFIG.HEADER_ROW;

      row < values.length;

      row++

    ) {

      try {

        const result =
          processRow(

            values[row],

            options

          );

        switch (result.status) {

          case "SUCCESS":

            Log.success(

              sheet,

              row + 1,

              result.message

            );

            processed++;

            break;

          case "SKIPPED":

            Log.skipped(

              sheet,

              row + 1,

              result.message

            );

            skipped++;

            break;

          default:

            Log.failure(

              sheet,

              row + 1,

              result.message

            );

            failed++;

        }

      }

      catch (error) {

        failed++;

        Log.exception(error);

        Log.failure(

          sheet,

          row + 1,

          error.message

        );

      }

    }

    Log.info(

      "Synchronisation complete.\n\n" +

      "Processed: " +

      processed +

      "\nSkipped: " +

      skipped +

      "\nFailed: " +

      failed

    );

  }

  /**
   * Processes a single row.
   */
  function processRow(
    row,
    options
  ) {

    const reference =

      normalise(

        row[
          CONFIG.COLUMN_REFERENCE_ID - 1
        ]

      );

    const videoId =

      normalise(

        row[
          CONFIG.COLUMN_VIDEO_ID - 1
        ]

      );

    if (!reference) {

      return {

        status: "SKIPPED",

        message:
          "Missing Reference"

      };

    }

    if (!videoId) {

      return {

        status: "SKIPPED",

        message:
          "Missing Brightcove ID"

      };

    }

    const lesson =
      Lessons.get(reference);

    const validation =
      Lessons.validate(lesson);

    if (!validation.valid) {

      return {

        status: "FAILED",

        message:
          validation.message

      };

    }

    const video =
      BrightcoveApi.getVideo(
        videoId
      );

    if (!video) {

      return {

        status: "FAILED",

        message:
          "Brightcove video not found"

      };

    }

    const masterPatch =

      buildMasterPatch(

        video,

        lesson,

        reference

      );

    const variantOperations =

      buildVariantOperations(

        video,

        lesson

      );

    return executeOperations(

      video,

      masterPatch,

      variantOperations,

      options

    );

  }
    /**
   * Builds the PATCH payload for the master video.
   *
   * Returns an empty object if no changes are required.
   */
  function buildMasterPatch(
    video,
    lesson,
    reference
  ) {

    const patch = {};

    if (
      normalise(video.reference_id) !==
      normalise(reference)
    ) {

      patch.reference_id = reference;

    }

    if (
      normalise(video.name) !==
      normalise(lesson.titles.en)
    ) {

      patch.name =
        lesson.titles.en;

    }

    if (
      normalise(video.description) !==
      normalise(lesson.descriptions.en)
    ) {

      patch.description =
        lesson.descriptions.en;

    }

    if (
      normalise(video.long_description) !==
      normalise(lesson.descriptions.en)
    ) {

      patch.long_description =
        lesson.descriptions.en;

    }

    return patch;

  }

  /**
   * Builds a list of required variant operations.
   *
   * Returns:
   *
   * [
   *   {
   *     action:"create",
   *     language:"fr",
   *     payload:{...}
   *   },
   *   {
   *     action:"update",
   *     language:"de",
   *     payload:{...}
   *   }
   * ]
   */
  function buildVariantOperations(
    video,
    lesson
  ) {

    const operations = [];

    const variants =
      BrightcoveApi.getVariantLookup(
        video
      );

    for (
      const language
      of CONFIG.VARIANT_LANGUAGES
    ) {

      const existing =
        variants[language];

      const desired = {

        name:
          lesson.titles[language],

        description:
          lesson.descriptions[language],

        long_description:
          lesson.descriptions[language]

      };

      if (!existing) {

        operations.push({

          action: "create",

          language: language,

          payload: Object.assign(

            {

              language: language

            },

            desired

          )

        });

        continue;

      }

      const patch = {};

      if (

        normalise(existing.name) !==

        normalise(desired.name)

      ) {

        patch.name =
          desired.name;

      }

      if (

        normalise(existing.description) !==

        normalise(desired.description)

      ) {

        patch.description =
          desired.description;

      }

      if (

        normalise(existing.long_description) !==

        normalise(desired.long_description)

      ) {

        patch.long_description =
          desired.long_description;

      }

      if (
        Object.keys(patch).length > 0
      ) {

        operations.push({

          action: "update",

          language: language,

          payload: patch

        });

      }

    }

    return operations;

  }

  /**
   * Normalises values before comparison.
   */
  function normalise(
    value
  ) {

    if (
      value === null ||
      value === undefined
    ) {

      return "";

    }

    return String(value).trim();

  }
    /**
   * Executes all required Brightcove operations.
   */
  function executeOperations(
    video,
    masterPatch,
    variantOperations,
    options
  ) {

    const stats = {

      masterUpdated: false,

      variantsCreated: 0,

      variantsUpdated: 0

    };

    /*
     * Update the master video first.
     */

    if (
      Object.keys(masterPatch).length > 0
    ) {

      BrightcoveApi.updateVideo(

        video.id,

        masterPatch,

        options

      );

      stats.masterUpdated = true;

    }

    /*
     * Execute all variant operations.
     */

    for (
      const operation
      of variantOperations
    ) {

      switch (
        operation.action
      ) {

        case "create":

          BrightcoveApi.createVariant(

            video.id,

            operation.payload,

            options

          );

          stats.variantsCreated++;

          break;

        case "update":

          BrightcoveApi.updateVariant(

            video.id,

            operation.language,

            operation.payload,

            options

          );

          stats.variantsUpdated++;

          break;

      }

    }

    return {

      status: "SUCCESS",

      message: buildStatus(stats)

    };

  }

  /**
   * Builds the status message written
   * back to Sheet1.
   */
  function buildStatus(
    stats
  ) {

    const messages = [];

    if (
      stats.masterUpdated
    ) {

      messages.push(
        "Master updated"
      );

    }

    if (
      stats.variantsCreated > 0
    ) {

      messages.push(

        "Created " +

        stats.variantsCreated +

        " variant" +

        (
          stats.variantsCreated === 1
            ? ""
            : "s"
        )

      );

    }

    if (
      stats.variantsUpdated > 0
    ) {

      messages.push(

        "Updated " +

        stats.variantsUpdated +

        " variant" +

        (
          stats.variantsUpdated === 1
            ? ""
            : "s"
        )

      );

    }

    if (
      messages.length === 0
    ) {

      return "No changes";

    }

    return messages.join(
      " | "
    );

  }

  /**
   * Public interface.
   */
  return {

    run

  };

})();
