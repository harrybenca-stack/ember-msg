import { adapt, handleConfig } from './_lib.js';
import { createStore } from './_db.js';
export default adapt(handleConfig, createStore);
