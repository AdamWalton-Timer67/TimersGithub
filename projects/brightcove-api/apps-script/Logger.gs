/***********************************************************************
 * Brightcove Metadata Synchroniser
 *
 * Logger.gs
 *
 * Handles logging and writing status back to Sheet1.
 ***********************************************************************/

const Log = (() => {

  function timestamp() {

    return Utilities.formatDate(

      new Date(),

      Session.getScriptTimeZone(),

      "yyyy-MM-dd HH:mm:ss"

    );

  }

  function write(
    level,
    message
  ) {

    Logger.log(

      "[" +

      level +

      "] " +

      timestamp() +

      " " +

      message

    );

  }

  function info(message) {

    write(
      "INFO",
      message
    );

  }

  function warn(message) {

    write(
      "WARN",
      message
    );

  }

  function error(message) {

    write(
      "ERROR",
      message
    );

  }

  function debug(message) {

    if (!CONFIG.DEBUG) {
      return;
    }

    write(
      "DEBUG",
      message
    );

  }

  /**
   * Writes a status to Column P.
   */
  function status(
    sheet,
    row,
    message
  ) {

    sheet
      .getRange(
        row,
        CONFIG.COLUMN_STATUS
      )
      .setValue(message);

  }

  function success(
    sheet,
    row,
    message
  ) {

    status(

      sheet,

      row,

      "SUCCESS - " +

      message

    );

  }

  function failure(
    sheet,
    row,
    message
  ) {

    status(

      sheet,

      row,

      "FAILED - " +

      message

    );

  }

  function skipped(
    sheet,
    row,
    message
  ) {

    status(

      sheet,

      row,

      "SKIPPED - " +

      message

    );

  }

  function clear(
    sheet,
    row
  ) {

    sheet
      .getRange(
        row,
        CONFIG.COLUMN_STATUS
      )
      .clearContent();

  }

  /**
   * Logs an exception.
   */
  function exception(error) {

    Logger.log(

      "[EXCEPTION] " +

      timestamp() +

      "\n" +

      error.message +

      "\n\n" +

      error.stack

    );

  }

  return {

    info,

    warn,

    error,

    debug,

    success,

    failure,

    skipped,

    clear,

    exception

  };

})();
