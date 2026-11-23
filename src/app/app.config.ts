import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {provideRouter} from '@angular/router';
import {provideServiceWorker} from '@angular/service-worker';

import {routes} from './app.routes';
import { StorageService } from './services/storage';
import { DataService } from './services/data';
import { SessionService } from './services/session';
import { CloudService } from './services/cloud';
import { AppErrorHandler } from './services/app-error-handler';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: AppErrorHandler },
    provideRouter(routes),
    // Offline shell after the first visit; a new build waits for the user's
    // tap in the app banner instead of reloading during data entry.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    // Nothing renders until the database is open and every collection is in
    // memory, so a page can never show an empty shop and then save over real data.
    provideAppInitializer(async () => {
      const storage = inject(StorageService);
      const data = inject(DataService);
      const session = inject(SessionService);
      const cloud = inject(CloudService);
      await storage.init();
      await data.initDatabase();
      // The cloud config must be live before a restored session asks for sync;
      // otherwise the first pull is skipped and waits for the next poll.
      await cloud.loadRuntimeConfig();
      cloud.load();
      session.load();
    }),
  ],
};
