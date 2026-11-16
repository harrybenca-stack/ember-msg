import { adapt, handleMessages } from './_lib.js';
import { createStore } from './_db.js';
export default adapt(handleMessages, createStore);
