/***********************************************************************
 * Brightcove Metadata Synchroniser
 *
 * BrightcoveApi.gs
 *
 * Wrapper around the Brightcove CMS API.
 *
 * All communication with Brightcove goes through this file.
 ***********************************************************************/

const BrightcoveApi = (() => {

  let accessToken = null;
  let tokenExpiry = 0;

  /**
   * Returns an OAuth access token.
   * Automatically refreshes when required.
   */
  function getAccessToken() {

    const now = Date.now();

    if (
      accessToken &&
      now < tokenExpiry
    ) {
      return accessToken;
    }

    Log.info("Requesting Brightcove OAuth token...");

    const auth = Utilities.base64Encode(
      CONFIG.CLIENT_ID +
      ":" +
      CONFIG.CLIENT_SECRET
    );

    const response = UrlFetchApp.fetch(

      CONFIG.OAUTH_URL,

      {

        method: "post",

        muteHttpExceptions: true,

        headers: {

          Authorization:
            "Basic " + auth

        },

        payload: {

          grant_type:
            "client_credentials"

        }

      }

    );

    if (
      response.getResponseCode() !== 200
    ) {

      throw new Error(

        "Unable to obtain Brightcove OAuth token.\n\n" +

        response.getContentText()

      );

    }

    const json = JSON.parse(
      response.getContentText()
    );

    accessToken =
      json.access_token;

    tokenExpiry =

      now +

      (
        json.expires_in -

        CONFIG.TOKEN_REFRESH_BUFFER_SECONDS

      ) * 1000;

    return accessToken;

  }

  /**
   * Generic Brightcove request.
   */
  function request(
    method,
    endpoint,
    payload = null
  ) {

    let attempt = 0;

    while (true) {

      const options = {

        method,

        muteHttpExceptions: true,

        headers: {

          Authorization:

            "Bearer " +

            getAccessToken(),

          "Content-Type":

            "application/json"

        }

      };

      if (payload) {

        options.payload =
          JSON.stringify(payload);

      }

      const response =
        UrlFetchApp.fetch(

          CONFIG.CMS_BASE_URL +

          CONFIG.ACCOUNT_ID +

          endpoint,

          options

        );

      const code =
        response.getResponseCode();

      const body =
        response.getContentText();

      if (
        code >= 200 &&
        code < 300
      ) {

        if (!body) {
          return {};
        }

        return JSON.parse(body);

      }

      if (
        code === 429 ||
        code >= 500
      ) {

        attempt++;

        if (
          attempt >
          CONFIG.MAX_RETRIES
        ) {

          throw new Error(
            body
          );

        }

        const wait =

          CONFIG.INITIAL_RETRY_DELAY_MS *

          Math.pow(
            2,
            attempt - 1
          );

        Log.warn(

          "Retry " +

          attempt +

          " in " +

          wait +

          "ms"

        );

        Utilities.sleep(wait);

        continue;

      }

      throw new Error(

        "Brightcove API Error\n\n" +

        code +

        "\n\n" +

        body

      );

    }

  }

  /**
   * Returns a Brightcove video.
   */
  function getVideo(
    videoId
  ) {

    return request(

      "get",

      "/videos/" +
      videoId

    );

  }

  /**
   * Updates a Brightcove video.
   */
  function updateVideo(
    videoId,
    payload,
    options = {}
  ) {

    if (
      options.dryRun
    ) {

      Log.info(
        "[Dry Run] Update Video"
      );

      return {};

    }

    return request(

      "patch",

      "/videos/" +
      videoId,

      payload

    );

  }
     /**
   * Returns the variants embedded in the
   * Brightcove video object.
   */
  function getVariants(
    video
  ) {

    if (
      !video ||
      !Array.isArray(video.variants)
    ) {

      return [];

    }

    return video.variants;

  }

  /**
   * Creates a lookup of variants keyed by language.
   *
   * Example:
   *
   * {
   *   fr:{...},
   *   de:{...},
   *   es:{...}
   * }
   */
  function getVariantLookup(
    video
  ) {

    const lookup = {};

    const variants =
      getVariants(video);

    for (
      const variant
      of variants
    ) {

      lookup[
        variant.language
      ] = variant;

    }

    return lookup;

  }

  /**
   * Creates a new language variant.
   */
  function createVariant(
    videoId,
    payload,
    options = {}
  ) {

    if (options.dryRun) {

      Log.info(

        "[Dry Run] Create Variant (" +

        payload.language +

        ")"

      );

      return {};

    }

    return request(

      "post",

      "/videos/" +
      videoId +
      "/variants",

      payload

    );

  }

  /**
   * Updates an existing language variant.
   */
  function updateVariant(
    videoId,
    language,
    payload,
    options = {}
  ) {

    if (options.dryRun) {

      Log.info(

        "[Dry Run] Update Variant (" +

        language +

        ")"

      );

      return {};

    }

    return request(

      "patch",

      "/videos/" +
      videoId +
      "/variants/" +
      encodeURIComponent(language),

      payload

    );

  }

  /**
   * Finds a Brightcove video by reference_id.
   *
   * Not used by this synchroniser because the
   * Video ID already exists in Sheet1, but useful
   * for future tools.
   */
  function searchByReferenceId(
    referenceId
  ) {

    const result = request(

      "get",

      "/videos?q=reference_id:" +

      encodeURIComponent(referenceId)

    );

    if (

      Array.isArray(result) &&

      result.length > 0

    ) {

      return result[0];

    }

    return null;

  }

  /**
   * Simple connection test.
   */
  function testConnection() {

    request(

      "get",

      "/videos?limit=1"

    );

    return true;

  }

  /**
   * Public interface.
   */
  return {

  getVideo,

  updateVideo,

  getVariants,

  getVariantLookup,

  createVariant,

  updateVariant,

  searchByReferenceId,

  testConnection

};

})();
