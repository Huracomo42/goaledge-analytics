import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';

const credPath = process.env.FIREBASE_CREDENTIALS_PATH;
if (!credPath) {
  throw new Error('FIREBASE_CREDENTIALS_PATH no está definida en .env');
}

// resolve() usa process.cwd() como base → la ruta es relativa a donde se lanza el script
const serviceAccount = JSON.parse(readFileSync(resolve(credPath), 'utf-8'));

// Guard: initializeApp falla si se llama dos veces; esto permite importar init.js múltiples veces sin riesgo
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
