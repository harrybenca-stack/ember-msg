import { adapt, handleSignal } from './_lib.js';
import { createStore } from './_db.js';
export default adapt(handleSignal, createStore);
