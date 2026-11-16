import { adapt, handleSignup } from './_lib.js';
import { createStore } from './_db.js';
export default adapt(handleSignup, createStore);
