import { defineConfig } from 'drizzle-kit';

export const DB_USERNAME: string = 'smugmug_user';
export const DB_PASSWORD: string = 'smugmug_password';
export const DB_HOST: string = 'localhost';
export const DB_PORT: number = 3360;
export const DB_DATABASE: string = 'smugmug';
const url = `mysql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_DATABASE}`;

export default defineConfig({
  dialect: 'mysql',
  schema: './models/master-schema.ts',
  out: './drizzle',
  dbCredentials: {
    url,
  },
});
