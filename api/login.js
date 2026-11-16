import { adapt, handleLogin } from './_lib.js';
import { createStore } from './_db.js';
export default adapt(handleLogin, createStore);
