import {bootstrapApplication} from '@angular/platform-browser';
import {App} from './app/app';
import {appConfig} from './app/app.config';
import {NO_IMAGE} from './app/utils/no-image';

// Imported catalogs carry hundreds of dead photo URLs; any <img> that fails to
// load falls back to the neutral placeholder instead of a broken-image icon.
document.addEventListener('error', event => {
  const img = event.target as HTMLImageElement;
  if (!(img instanceof HTMLImageElement) || img.dataset['fallback']) return;
  img.dataset['fallback'] = '1';
  img.src = NO_IMAGE;
}, true);

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
