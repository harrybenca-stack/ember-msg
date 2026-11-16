// The messenger API's single Serverless Function. Vercel's Hobby plan
// caps a deployment at 12 functions, so every /api/* request lands in
// this catch-all and is routed by api/_router.js to the endpoint
// handlers in api/_lib.js (via the modules in api/_handlers/).
import { createApiHandler } from './_router.js';
import { createStore } from './_db.js';

export default createApiHandler(createStore);
