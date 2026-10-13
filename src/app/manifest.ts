import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Project Orion — Trading workspace',
    short_name: 'Orion',
    description: 'Your personal AI trading workspace.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0a0c10',
    theme_color: '#0a0c10',
    icons: [
      { src: '/icons/orion-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/orion-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/orion-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
