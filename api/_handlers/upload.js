// Endpoint module — NOT a Vercel function (underscore folder). It names the
// api/_lib.js handler for this endpoint; api/_router.js wraps it in the
// usual adapt() contract and api/[...slug].js is the only deployed function.
export { handleUpload as default } from '../_lib.js';
