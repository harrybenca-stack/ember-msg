import { adapt, handleMessageReact } from '../_lib.js';
import { createStore } from '../_db.js';
export default adapt(handleMessageReact, createStore);
