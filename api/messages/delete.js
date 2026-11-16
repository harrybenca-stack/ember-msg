import { adapt, handleMessageDelete } from '../_lib.js';
import { createStore } from '../_db.js';
export default adapt(handleMessageDelete, createStore);
