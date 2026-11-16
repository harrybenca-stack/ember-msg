import { adapt, handleUploadFile } from '../_lib.js';
import { createStore } from '../_db.js';
export default adapt(handleUploadFile, createStore);
