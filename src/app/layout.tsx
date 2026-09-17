import type { Metadata, Viewport } from 'next';
import MobileViewport from './mobile-viewport';
import ScannerNav from './scanner-nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'BlueRock IMS',
  description: 'BlueRock Inventory Management System',
  applicationName: 'BlueRock IMS',
  icons: {
    icon: '/icons/192',
    apple: '/icons/192',
  },
  appleWebApp: {
    capable: true,
    title: 'BlueRock IMS',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  interactiveWidget: 'resizes-content',
  viewportFit: 'cover',
  themeColor: '#242625',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><MobileViewport/>{children}<ScannerNav/></body>
    </html>
  );
}
