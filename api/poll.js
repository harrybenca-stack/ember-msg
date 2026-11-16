import { adapt, handlePoll } from './_lib.js';
import { createStore } from './_db.js';
export default adapt(handlePoll, createStore);
