import type { Metadata, Viewport } from 'next';
import { PwaRegister } from '@/components/pwa-register';
import '@livekit/components-styles';
import './globals.css';

export const metadata: Metadata = {
  title: 'Orion — Trading workspace',
  description: 'Your personal AI trading workspace.',
  appleWebApp: { capable: true, title: 'Orion', statusBarStyle: 'default' },
  icons: { icon: '/icons/orion-192.png', apple: '/icons/orion-192.png' },
};
export const viewport: Viewport = { themeColor: '#0a0c10', width: 'device-width', initialScale: 1 };

// Render per request so the public Supabase config can be read from the server's
// runtime environment. Next.js inlines NEXT_PUBLIC_* values at build time only, and
// some hosts build without those variables, so the server also hands them to the
// browser here. These are public values (URL + anon/publishable key), never secrets.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const publicEnv = {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined,
  };
  const serialized = JSON.stringify(publicEnv).replace(/</g, '\\u003c');
  return (
    <html lang="en">
      <body>
        <script dangerouslySetInnerHTML={{ __html: `window.__ORION_PUBLIC__=${serialized};` }} />
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
