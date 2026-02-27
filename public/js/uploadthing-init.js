/**
 * Load UploadThing client and expose uploadFiles so the image partial can upload
 * to UploadThing (tagged temporary) then POST the URL to /uploadPhoto for SmugMug.
 * Uses ESM from esm.sh so no build step is required.
 */
import { genUploader } from 'https://esm.sh/uploadthing@7/client';

const url = typeof window !== 'undefined' ? window.location.origin + '/api/uploadthing' : '';
const { uploadFiles } = genUploader({ url });
window.uploadFilesToUploadThing = uploadFiles;
