/**
 * Shared constants: event types, message kinds, field limits, rate limits.
 * Changing a value here changes the public API, so keep the README in sync.
 */

/** Allowed values for POST /v1/events `type`. */
export const EVENT_TYPES = ['view', 'download', 'preview', 'interest', 'fork_click', 'cite_copy'];

/** Maps an event type to its key in the `totals` object of the stats API. */
export const TYPE_TO_KEY = {
  view: 'views',
  download: 'downloads',
  preview: 'previews',
  interest: 'interest',
  fork_click: 'fork_clicks',
  cite_copy: 'cite_copies',
};

/** Event types reported per instrument (`by_instrument`). */
export const INSTRUMENT_TYPES = ['view', 'download', 'preview', 'interest'];

/** Event types reported in the daily `timeseries`. */
export const TIMESERIES_TYPES = ['view', 'download', 'preview'];

/** Event types reported per file (`by_file`). */
export const FILE_TYPES = ['download', 'preview'];

/** Number of days in the stats timeseries (including today). */
export const TIMESERIES_DAYS = 365;

/** Allowed values for POST /v1/messages `kind`. */
export const MESSAGE_KINDS = ['private', 'public', 'error', 'missing', 'general'];

/** Kinds that always go to the private inbox, whatever `visibility` says. */
export const ALWAYS_PRIVATE_KINDS = ['private', 'error', 'missing'];

/** Allowed values for POST /v1/access-requests `intended_use`. */
export const INTENDED_USES = ['academic', 'commercial', 'other'];

/** GitHub issue labels in the private inbox repo. Pre-create them there. */
export const ISSUE_LABELS = {
  private: 'private-message',
  error: 'error-report',
  missing: 'missing-material',
  general: 'general-inquiry',
  public: 'public-message',
  access: 'access-request',
};

/** Added to every issue the worker creates, so they are easy to filter. */
export const SOURCE_LABEL = 'via-stac-api';

/** Field length limits (characters, after trimming). */
export const LIMITS = {
  subject: { min: 3, max: 200 },
  body: { min: 5, max: 5000 },
  name: { min: 1, max: 100 },
  email: { max: 254 },
  institution: { min: 2, max: 200 },
  purpose: { min: 20, max: 3000 },
  note: { max: 2000 },
  filePath: { max: 300 },
};

/** Maximum accepted request body sizes in bytes. */
export const MAX_BODY = {
  event: 4 * 1024,
  form: 32 * 1024,
  admin: 8 * 1024,
};

/**
 * Fixed-window rate limits, stored in D1 (table rate_limits).
 *   events:    per daily visitor hash
 *   forms:     messages + access requests, per daily visitor hash
 *   downloads: per approved access request (token)
 */
export const RATE_LIMITS = {
  events: { limit: 120, windowSec: 600 },
  forms: { limit: 10, windowSec: 3600 },
  downloads: { limit: 30, windowSec: 600 },
};

/** Default lifetime of a restricted-download link. */
export const DEFAULT_DOWNLOAD_TTL_DAYS = 7;

/** Default raw event retention. */
export const DEFAULT_RAW_RETENTION_DAYS = 90;

/** Default cache lifetime of the stats endpoints in seconds. */
export const DEFAULT_STATS_CACHE_SECONDS = 300;
