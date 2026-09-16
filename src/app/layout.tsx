import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BlueRock IMS Backend',
  description: 'BlueRock Inventory Management System API',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
