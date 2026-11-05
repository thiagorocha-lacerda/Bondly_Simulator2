// Registra o ts-ext-loader (resolução de imports extensionless .ts/.js) via --import.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register('./ts-ext-loader.mjs', pathToFileURL('./scripts/'));
