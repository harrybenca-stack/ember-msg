import { adapt, handleLogout } from './_lib.js';
import { createStore } from './_db.js';
export default adapt(handleLogout, createStore);
