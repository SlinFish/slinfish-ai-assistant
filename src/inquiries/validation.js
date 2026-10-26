import { isBusiness } from '../businesses.js';
export const LIMITS = Object.freeze({ name: 100, contact: 150, question: 400 });
export class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function validText(value, limit, multiline = false) {
  return typeof value === 'string' && value.isWellFormed() && value.length <= limit && value.trim().length > 0
    && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/ : /[\u0000-\u001f\u007f-\u009f]/).test(value);
}
export function validateInquiry(value) {
  const fields = ['business', 'name', 'contact', 'question', 'consent'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))
    || !isBusiness(value.business) || value.consent !== true
    || !validText(value.name, LIMITS.name) || !validText(value.contact, LIMITS.contact)
    || !validText(value.question, LIMITS.question, true)) throw new RequestError(400, 'Invalid inquiry fields or consent');
  return { business: value.business, name: value.name.trim(), contact: value.contact.trim(), question: value.question.trim(), consent: true };
}
