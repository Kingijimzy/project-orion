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
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><PwaRegister/>{children}</body></html>; }
