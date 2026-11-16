import { adapt, handleUpload } from './_lib.js';
import { createStore } from './_db.js';
export default adapt(handleUpload, createStore);
