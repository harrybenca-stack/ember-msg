import { adapt, handleMessageEdit } from '../_lib.js';
import { createStore } from '../_db.js';
export default adapt(handleMessageEdit, createStore);
