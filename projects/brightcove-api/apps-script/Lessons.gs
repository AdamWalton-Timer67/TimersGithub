/***********************************************************************
 * Brightcove Metadata Synchroniser
 *
 * Lessons.gs
 *
 * Loads the external Lessons spreadsheet into memory and provides
 * fast lookups by Video Reference.
 ***********************************************************************/

const Lessons = (() => {

  let lessonLookup = null;

  /**
   * Loads the Lessons sheet into memory.
   *
   * Safe to call multiple times.
   */
  function load() {

    if (lessonLookup !== null) {
      return;
    }

    Log.info(
      "Loading Lessons spreadsheet..."
    );

    const spreadsheet =
      SpreadsheetApp.openById(
        CONFIG.LESSONS_SPREADSHEET_ID
      );

    const sheet =
      spreadsheet.getSheetByName(
        CONFIG.LESSONS_SHEET_NAME
      );

    if (!sheet) {

      throw new Error(
        "Lessons sheet not found."
      );

    }

    const values =
      sheet
        .getDataRange()
        .getValues();

    lessonLookup = {};

    for (
      let row = CONFIG.HEADER_ROW;
      row < values.length;
      row++
    ) {

      const record =
        buildLessonRecord(
          values[row]
        );

      if (!record) {
        continue;
      }

      lessonLookup[
        record.reference
      ] = record;

    }

    Log.info(

      "Loaded " +

      Object.keys(
        lessonLookup
      ).length +

      " lessons."

    );

  }

  /**
   * Returns a lesson by reference.
   */
  function get(
    reference
  ) {

    load();

    return (
      lessonLookup[
        normalise(reference)
      ] || null
    );

  }

  /**
   * Clears the cache.
   */
  function clearCache() {

    lessonLookup = null;

  }

  /**
   * Creates a lesson object from a row.
   */
  function buildLessonRecord(
    row
  ) {

    const reference =
      normalise(

        row[
          CONFIG.LESSON_COLUMN_REFERENCE - 1
        ]

      );

    if (!reference) {
      return null;
    }

    return {

      reference,

      titles: {

        en: value(row, CONFIG.TITLE_COLUMNS.en),
        fr: value(row, CONFIG.TITLE_COLUMNS.fr),
        de: value(row, CONFIG.TITLE_COLUMNS.de),
        es: value(row, CONFIG.TITLE_COLUMNS.es),
        ja: value(row, CONFIG.TITLE_COLUMNS.ja),
        it: value(row, CONFIG.TITLE_COLUMNS.it),
        zh: value(row, CONFIG.TITLE_COLUMNS.zh),
        ko: value(row, CONFIG.TITLE_COLUMNS.ko)

      },

      descriptions: {

        en: value(row, CONFIG.DESCRIPTION_COLUMNS.en),
        fr: value(row, CONFIG.DESCRIPTION_COLUMNS.fr),
        de: value(row, CONFIG.DESCRIPTION_COLUMNS.de),
        es: value(row, CONFIG.DESCRIPTION_COLUMNS.es),
        ja: value(row, CONFIG.DESCRIPTION_COLUMNS.ja),
        it: value(row, CONFIG.DESCRIPTION_COLUMNS.it),
        zh: value(row, CONFIG.DESCRIPTION_COLUMNS.zh),
        ko: value(row, CONFIG.DESCRIPTION_COLUMNS.ko)

      }

    };

  }

  /**
   * Validates a lesson.
   *
   * Returns:
   *
   * {
   *   valid:true
   * }
   *
   * or
   *
   * {
   *   valid:false,
   *   message:"Missing FR Title"
   * }
   */
  function validate(
    lesson
  ) {

    if (!lesson) {

      return {

        valid: false,

        message:
          "Lesson not found"

      };

    }

    const languages = [

      "en",
      ...CONFIG.VARIANT_LANGUAGES

    ];

    for (
      const language
      of languages
    ) {

      if (
        !lesson.titles[
          language
        ]
      ) {

        return {

          valid: false,

          message:

            "Missing " +

            language.toUpperCase() +

            " Title"

        };

      }

      if (
        !lesson.descriptions[
          language
        ]
      ) {

        return {

          valid: false,

          message:

            "Missing " +

            language.toUpperCase() +

            " Description"

        };

      }

    }

    return {

      valid: true

    };

  }

  /**
   * Returns a trimmed string.
   */
  function value(
    row,
    column
  ) {

    return normalise(
      row[column - 1]
    );

  }

  /**
   * Normalises values for comparison.
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

    return String(value)
      .trim();

  }

  /**
   * Public interface.
   */
  return {

    load,

    get,

    validate,

    clearCache

  };

})();
