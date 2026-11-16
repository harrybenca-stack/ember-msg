// The messenger API's single Serverless Function. Vercel's Hobby plan
// caps a deployment at 12 functions, so every API request is rewritten
// (see vercel.json) onto this one function — /api/<path> arrives as
// /api/dispatch?path=<path>, and /uploads/<name> as
// /api/dispatch?path=uploads/<name> — and api/_router.js routes it to the
// endpoint handlers in api/_lib.js (via the modules in api/_handlers/).
import { createApiHandler } from './_router.js';
import { createStore } from './_db.js';

export default createApiHandler(createStore);
