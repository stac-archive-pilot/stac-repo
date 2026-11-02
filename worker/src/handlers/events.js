/**
 * POST /v1/events  (no Turnstile; sendBeacon-friendly)
 *
 * Body (application/json or text/plain containing JSON):
 *   {type, instrument_id, file_path?, optin_id?}
 * Response: 204, or 400/413/415/429 with the standard error body.
 */

import { noContent, readJsonBody } from '../lib/http.js';
import { EVENT_TYPES, MAX_BODY, RATE_LIMITS } from '../lib/constants.js';
import * as v from '../lib/validate.js';
import { insertEventRateLimited } from '../lib/db.js';
import { requireEnv, visitorContext } from './common.js';

export async function handleEvent({ request, env }) {
  const db = requireEnv(env, 'DB');
  const body = await readJsonBody(request, { maxBytes: MAX_BODY.event, allowTextPlain: true });

  const type = v.oneOf(body.type, EVENT_TYPES, { field: 'type' });
  const instrumentId = v.instrumentId(body.instrument_id);
  const filePath = v.filePath(body.file_path);
  const optinId = v.optinId(body.optin_id);

  const visitor = await visitorContext(request, env, optinId);
  await insertEventRateLimited(
    db,
    {
      ts: visitor.ts,
      day: visitor.day,
      type,
      instrumentId,
      filePath,
      visitorHash: visitor.visitorHash,
      pseudonym: visitor.pseudonym,
    },
    RATE_LIMITS.events,
  );
  return noContent();
}
