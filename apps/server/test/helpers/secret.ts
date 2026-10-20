import { Buffer } from 'node:buffer';

export const TEST_SECRET_KEY = Buffer.alloc(32, 3).toString('base64');
