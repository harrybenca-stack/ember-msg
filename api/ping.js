import { adapt, handlePing } from './_lib.js';
import { createStore } from './_db.js';
export default adapt(handlePing, createStore);
