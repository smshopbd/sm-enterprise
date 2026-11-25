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
    // Offline shell after the first visit. Registration runs immediately so a
    // freshly deployed build is noticed at startup; App decides exactly when
    // the swap reload may run without losing typed data.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerImmediately',
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
