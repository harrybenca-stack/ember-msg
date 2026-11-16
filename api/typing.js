import { adapt, handleTyping } from './_lib.js';
import { createStore } from './_db.js';
export default adapt(handleTyping, createStore);
