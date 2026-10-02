import { customAlphabet } from "nanoid";

const ALPHANUM_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const createShortId = customAlphabet(ALPHANUM_ALPHABET, 12);
