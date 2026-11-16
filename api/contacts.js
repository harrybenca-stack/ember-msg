import { adapt, handleContacts } from './_lib.js';
import { createStore } from './_db.js';
export default adapt(handleContacts, createStore);
