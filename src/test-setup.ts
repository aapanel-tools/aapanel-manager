import {config} from 'dotenv';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env so DATABASE_URL and other env vars are available in all tests.
// __dirname = <repo>/src, so one level up reaches <repo>/.env
config({path: path.resolve(__dirname, '../.env')});
