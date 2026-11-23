import {RenderMode, ServerRoute} from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'v/:type/:key',
    renderMode: RenderMode.Client,
  },
  {
    path: 'warranty/receive/:id/edit',
    renderMode: RenderMode.Client,
  },
  {
    path: 'warranty/replace/:id/edit',
    renderMode: RenderMode.Client,
  },
  {
    path: '**',
    renderMode: RenderMode.Prerender,
  },
];
