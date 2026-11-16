import { adapt, handleSeen } from './_lib.js';
import { createStore } from './_db.js';
export default adapt(handleSeen, createStore);
