/**
 * Design decision D-10: a card is slots, so nothing on screen says how long a show or a match
 * runs. Tests match rendered text and fixed wording against this to catch a running time.
 */
export const RUNNING_TIME_WORDS = /\bmin(ute)?s?\b|hour|length/i;
